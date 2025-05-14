import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Autocomplete,
  Divider
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  Save as SaveIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Stop as StopIcon,
} from '@mui/icons-material';

interface SavedScript {
  id: number;
  name: string;
  description: string;
  body: string;
  category: string;
}

const FilesystemOps = () => {
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedScript, setSelectedScript] = useState<SavedScript | null>(null);
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [scriptExpanded, setScriptExpanded] = useState(false);
  const [repeatInterval, setRepeatInterval] = useState<string>('');
  const [repeatTimer, setRepeatTimer] = useState<NodeJS.Timeout | null>(null);
  const [lastRunTime, setLastRunTime] = useState<Date | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [scriptName, setScriptName] = useState('');
  const [scriptDescription, setScriptDescription] = useState('');
  const [scriptCategory, setScriptCategory] = useState('');
  const [scriptBody, setScriptBody] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingScript, setPendingScript] = useState<SavedScript | null>(null);
  const [scriptArgs, setScriptArgs] = useState<string>('');
  const [scriptArgHistory, setScriptArgHistory] = useState<string[]>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [originalScriptName, setOriginalScriptName] = useState<string>('');

  // Load saved scripts and categories on component mount
  useEffect(() => {
    loadScripts();
    loadCategories();
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (repeatTimer) {
        clearInterval(repeatTimer);
      }
    };
  }, [repeatTimer]);

  const loadScripts = async () => {
    try {
      const response = await fetch('http://localhost:8001/api/fs/scripts');
      const data = await response.json();
      setSavedScripts(data.scripts);
    } catch (err) {
      console.error('Error loading scripts:', err);
      setError('Failed to load scripts');
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch('http://localhost:8001/api/fs/categories');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.detail) {
        // If there's an error message, set empty categories
        setCategories([]);
        return;
      }
      setCategories(Array.isArray(data.categories) ? data.categories : []);
    } catch (err) {
      console.error('Error loading categories:', err);
      setError('Failed to load categories');
      setCategories([]); // Set empty array on error
    }
  };

  const loadScriptArgs = async (scriptName: string) => {
    try {
      const response = await fetch(`http://localhost:8001/api/fs/scripts/${scriptName}/args`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.args)) {
        setScriptArgHistory([]);
        setScriptArgs('');
        return;
      }
      setScriptArgHistory(data.args);
      // Set the most recent args as the current value
      if (data.args.length > 0) {
        setScriptArgs(data.args[0]);
      } else {
        setScriptArgs('');
      }
    } catch (err) {
      console.error('Error loading script args:', err);
      setScriptArgHistory([]);
      setScriptArgs('');
    }
  };

  const handleScriptSelect = async (script: SavedScript | null) => {
    if (hasUnsavedChanges) {
      setPendingScript(script);
      setConfirmDialogOpen(true);
      return;
    }
    await selectScript(script);
  };

  const selectScript = async (script: SavedScript | null) => {
    if (script) {
      try {
        const response = await fetch(`http://localhost:8001/api/fs/scripts/${script.name}`);
        const fullScript = await response.json();
        setSelectedScript(fullScript);
        setOriginalScriptName(fullScript.name);
        await loadScriptArgs(script.name);
        setHasUnsavedChanges(false);  // Reset the flag when selecting a script
      } catch (err) {
        console.error('Error loading script:', err);
        setError('Failed to load script');
      }
    } else {
      setSelectedScript(null);
      setScriptArgs('');
      setScriptArgHistory([]);
      setOriginalScriptName('');
      setHasUnsavedChanges(false);  // Reset the flag when clearing selection
    }
  };

  const handleRunScript = async () => {
    if (!selectedScript) return;

    setLoading(true);
    setError(null);
    setOutput('');  // Clear output at the start
    setLastRunTime(new Date());
    
    // Create new AbortController for this execution
    const controller = new AbortController();
    setAbortController(controller);
    
    try {
      // First, get the latest version of the script from the database
      const scriptResponse = await fetch(`http://localhost:8001/api/fs/scripts/${selectedScript.name}`);
      if (!scriptResponse.ok) {
        throw new Error(`Failed to fetch script: ${scriptResponse.status}`);
      }
      const latestScript = await scriptResponse.json();
      
      // Update the selected script with the latest version
      setSelectedScript(latestScript);

      const response = await fetch('http://localhost:8001/api/fs/execute-script-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: latestScript.name,
          args: scriptArgs
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';
      let currentOutput = '';
      let currentError = '';

      const textDecoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += textDecoder.decode(value, { stream: true });

        let boundaryIndex;
        // Process as many complete event blocks as we have
        while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, boundaryIndex).trim();
          buffer = buffer.slice(boundaryIndex + 2); // Skip the "\n\n"

          if (!rawEvent) continue;

          const lines = rawEvent.split('\n');
          let eventType = 'message';
          let dataLine = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataLine = line.slice(6);
            }
          }

          const unescapedData = dataLine.replace(/\\n/g, '\n');

          switch (eventType) {
            case 'output':
              currentOutput += unescapedData;
              setOutput(currentOutput);
              break;
            case 'error':
              currentError += unescapedData;
              setError(currentError);
              break;
            case 'done':
              console.log('Script execution completed');
              break;
            default:
              // Unknown / ignore
              break;
          }
        }
      }

      // Flush any remaining buffered data (in case stream ended without trailing "\n\n")
      if (buffer.length > 0) {
        const lines = buffer.split('\n');
        let eventType = 'message';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataLine = line.slice(6);
          }
        }
        const unescapedData = dataLine.replace(/\\n/g, '\n');
        if (eventType === 'output') {
          currentOutput += unescapedData;
          setOutput(currentOutput);
        } else if (eventType === 'error') {
          currentError += unescapedData;
          setError(currentError);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Script execution cancelled');
      } else {
        console.error('Script execution error:', err);
        setError(err instanceof Error ? err.message : 'Failed to execute script');
      }
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  const handleRepeatIntervalChange = (value: string) => {
    if (repeatTimer) {
      clearInterval(repeatTimer);
      setRepeatTimer(null);
    }

    setRepeatInterval(value);

    const seconds = parseInt(value);
    if (!isNaN(seconds) && seconds > 0) {
      const timer = setInterval(() => {
        handleRunScript();
      }, seconds * 1000);
      setRepeatTimer(timer);
    }
  };

  const handleSaveScript = async () => {
    try {
      const response = await fetch('http://localhost:8001/api/fs/save-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: scriptName,
          description: scriptDescription,
          body: scriptBody,
          category: scriptCategory || 'Uncategorized'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setSaveDialogOpen(false);
      setScriptName('');
      setScriptDescription('');
      setScriptCategory('');
      setScriptBody('');
      loadScripts();
      loadCategories();
    } catch (err) {
      console.error('Error saving script:', err);
      setError('Failed to save script');
    }
  };

  const handleDeleteScript = async (script: SavedScript) => {
    try {
      const response = await fetch(`http://localhost:8001/api/fs/scripts/${script.name}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      loadScripts();
      if (selectedScript?.name === script.name) {
        setSelectedScript(null);
        setScriptArgs('');
        setScriptArgHistory([]);
      }
    } catch (err) {
      console.error('Error deleting script:', err);
      setError('Failed to delete script');
    }
  };

  const handleEditScript = (script: SavedScript) => {
    setScriptName(script.name);
    setScriptDescription(script.description);
    setScriptCategory(script.category);
    setScriptBody(script.body);
    setSaveDialogOpen(true);
  };

  const formatLastRunTime = (date: Date) => {
    return date.toLocaleTimeString();
  };

  const handleSaveChanges = async () => {
    if (!selectedScript) return;

    try {
      let response: Response;

      if (selectedScript.name !== originalScriptName && originalScriptName) {
        // Name changed – call rename endpoint
        response = await fetch('http://localhost:8001/api/fs/rename-script', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            old_name: originalScriptName,
            new_name: selectedScript.name,
            description: selectedScript.description,
            body: selectedScript.body,
            category: selectedScript.category
          }),
        });
      } else {
        // Only content changed – regular save
        response = await fetch('http://localhost:8001/api/fs/save-script', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: selectedScript.name,
            description: selectedScript.description,
            body: selectedScript.body,
            category: selectedScript.category
          }),
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // If rename succeeded, update original name
      setOriginalScriptName(selectedScript.name);

      setHasUnsavedChanges(false);
      loadScripts();
      loadCategories();
    } catch (err) {
      console.error('Error saving changes:', err);
      setError('Failed to save changes');
    }
  };

  const handleConfirmDiscard = () => {
    setConfirmDialogOpen(false);
    setHasUnsavedChanges(false);
    selectScript(pendingScript);
    setPendingScript(null);
  };

  const handleCancelDiscard = () => {
    setConfirmDialogOpen(false);
    setPendingScript(null);
  };

  const handleCancelScript = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  };

  const filteredScripts = (savedScripts || []).filter(script => {
    const matchesCategory = selectedCategory === 'All' || script.category === selectedCategory;
    const matchesSearch = searchQuery === '' || 
      script.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      script.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Script Runner
      </Typography>

      {/* Action Buttons and Auto-repeat Field */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            onClick={handleRunScript}
            disabled={loading || !selectedScript}
            startIcon={<RunIcon />}
          >
            {loading ? 'Running...' : 'Run Script'}
          </Button>
          {loading && (
            <Button
              variant="outlined"
              color="error"
              onClick={handleCancelScript}
              startIcon={<StopIcon />}
            >
              Cancel
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<SaveIcon />}
            onClick={() => setSaveDialogOpen(true)}
          >
            New Script
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            label="Auto-repeat (seconds)"
            type="number"
            value={repeatInterval}
            onChange={(e) => handleRepeatIntervalChange(e.target.value)}
            sx={{ width: '150px' }}
          />
          {lastRunTime && (
            <Typography variant="body2" color="text.secondary">
              Last run: {lastRunTime.toLocaleTimeString()}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Loading Indicator */}
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <CircularProgress size={20} sx={{ mr: 1 }} />
          <Typography>Running script...</Typography>
        </Box>
      )}

      {/* Error Message */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Command Output */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">
            Command Output
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton onClick={() => setOutputExpanded(!outputExpanded)}>
              {outputExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
        </Box>
        <Paper
          sx={{
            p: 2,
            bgcolor: 'background.paper',
            color: 'text.primary',
            fontFamily: 'monospace',
            whiteSpace: 'pre',
            overflow: 'auto',
            height: outputExpanded ? 'calc(100vh - 200px)' : '300px',
            border: 1,
            borderColor: 'divider',
            transition: 'height 0.3s ease-in-out'
          }}
        >
          {output}
        </Paper>
      </Box>

      {/* Error Output */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" color="error">
            Command Error
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton onClick={() => setErrorExpanded(!errorExpanded)}>
              {errorExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
        </Box>
        <Paper
          sx={{
            p: 2,
            bgcolor: 'background.paper',
            color: 'error.main',
            fontFamily: 'monospace',
            whiteSpace: 'pre',
            overflow: 'auto',
            height: errorExpanded ? 'calc(100vh - 200px)' : '150px',
            border: 1,
            borderColor: 'error.main',
            transition: 'height 0.3s ease-in-out'
          }}
        >
          {error || 'No errors'}
        </Paper>
      </Box>

      {/* Script Selection and Configuration */}
      <Box sx={{ mb: 3 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
            <Autocomplete
              options={['All', ...categories]}
              value={selectedCategory}
              onChange={(_, newValue) => setSelectedCategory(newValue || 'All')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Category"
                  variant="outlined"
                  sx={{ width: '200px' }}
                />
              )}
            />
            <TextField
              label="Search Scripts"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              variant="outlined"
              sx={{ flexGrow: 1 }}
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Autocomplete
              options={filteredScripts}
              getOptionLabel={(option) => `${option.name} - ${option.description}`}
              value={selectedScript}
              onChange={(_, newValue) => handleScriptSelect(newValue)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Select Script"
                  variant="outlined"
                />
              )}
              renderOption={(props, option) => {
                const { key, ...rest } = props as any;
                return (
                  <ListItem {...rest} key={key}>
                    <ListItemText
                      primary={option.name}
                      secondary={
                        <>
                          <Typography component="span" variant="body2" color="text.primary">
                            {option.category}
                          </Typography>
                          {' — '}
                          {option.description}
                        </>
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteScript(option);
                        }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                );
              }}
            />
          </Box>

          {selectedScript && (
            <>
              <Box sx={{ mb: 2 }}>
                <Autocomplete
                  freeSolo
                  options={scriptArgHistory}
                  value={scriptArgs}
                  onChange={(_, newValue) => setScriptArgs(newValue || '')}
                  onInputChange={(_, newValue) => setScriptArgs(newValue)}
                  openOnFocus
                  filterOptions={(opts) => opts}
                  getOptionLabel={(option) => option}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Script Arguments (latest auto-filled)"
                      variant="outlined"
                      fullWidth
                    />
                  )}
                />
              </Box>

              <Box sx={{ mb: 2 }}>
                <TextField
                  label="Script Name"
                  value={selectedScript.name}
                  onChange={(e) => {
                    setSelectedScript({ ...selectedScript, name: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  fullWidth
                  margin="normal"
                />
                <TextField
                  label="Description"
                  value={selectedScript.description}
                  onChange={(e) => {
                    setSelectedScript({ ...selectedScript, description: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  fullWidth
                  margin="normal"
                />
                <Autocomplete
                  freeSolo
                  options={categories}
                  value={selectedScript.category}
                  onChange={(_, newValue) => {
                    setSelectedScript({ ...selectedScript, category: newValue || 'Uncategorized' });
                    setHasUnsavedChanges(true);
                  }}
                  onInputChange={(_, newValue) => {
                    setSelectedScript({ ...selectedScript, category: newValue });
                    setHasUnsavedChanges(true);
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Category"
                      fullWidth
                      margin="normal"
                    />
                  )}
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle2">
                  Script Body
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {hasUnsavedChanges && (
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handleSaveChanges}
                      startIcon={<SaveIcon />}
                    >
                      Save Changes
                    </Button>
                  )}
                  <IconButton onClick={() => setScriptExpanded(!scriptExpanded)}>
                    {scriptExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                </Box>
              </Box>
              <TextField
                multiline
                fullWidth
                rows={scriptExpanded ? 30 : 10}
                value={selectedScript.body}
                onChange={(e) => {
                  setSelectedScript({ ...selectedScript, body: e.target.value });
                  setHasUnsavedChanges(true);
                }}
                sx={{
                  fontFamily: 'monospace',
                  '& .MuiInputBase-input': {
                    fontFamily: 'monospace'
                  }
                }}
              />
            </>
          )}
        </Paper>
      </Box>

      {/* Save Script Dialog */}
      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)}>
        <DialogTitle>Save New Script</DialogTitle>
        <DialogContent>
          <TextField
            label="Script Name"
            value={scriptName}
            onChange={(e) => setScriptName(e.target.value)}
            fullWidth
            margin="normal"
          />
          <TextField
            label="Description"
            value={scriptDescription}
            onChange={(e) => setScriptDescription(e.target.value)}
            fullWidth
            margin="normal"
          />
          <Autocomplete
            freeSolo
            options={categories}
            value={scriptCategory}
            onChange={(_, newValue) => setScriptCategory(newValue || '')}
            onInputChange={(_, newValue) => setScriptCategory(newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Category"
                fullWidth
                margin="normal"
              />
            )}
          />
          <TextField
            label="Script Body"
            value={scriptBody}
            onChange={(e) => setScriptBody(e.target.value)}
            multiline
            rows={10}
            fullWidth
            margin="normal"
            sx={{
              fontFamily: 'monospace',
              '& .MuiInputBase-input': {
                fontFamily: 'monospace'
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSaveScript}
            variant="contained"
            disabled={!scriptName || !scriptBody}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Scripts Dialog */}
      <Dialog 
        open={editDialogOpen} 
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Edit Scripts</DialogTitle>
        <DialogContent>
          <List>
            {(savedScripts || []).map((script) => (
              <React.Fragment key={script.name}>
                <ListItem>
                  <ListItemText
                    primary={script.name}
                    secondary={script.description}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => handleDeleteScript(script)}
                      sx={{ mr: 1 }}
                    >
                      <DeleteIcon />
                    </IconButton>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => {
                        handleEditScript(script);
                        setEditDialogOpen(false);
                      }}
                    >
                      Edit
                    </Button>
                  </ListItemSecondaryAction>
                </ListItem>
                <Divider />
              </React.Fragment>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Discard Dialog */}
      <Dialog open={confirmDialogOpen} onClose={handleCancelDiscard}>
        <DialogTitle>Unsaved Changes</DialogTitle>
        <DialogContent>
          <Typography>
            You have unsaved changes. Do you want to discard them?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDiscard}>Cancel</Button>
          <Button onClick={handleConfirmDiscard} color="error">
            Discard Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default FilesystemOps; 