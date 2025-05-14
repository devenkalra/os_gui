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
  name: string;
  description: string;
  body: string;
}

const FilesystemOps = () => {
  const [savedScripts, setSavedScripts] = useState<Record<string, SavedScript>>({});
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
  const [scriptBody, setScriptBody] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingScript, setPendingScript] = useState<SavedScript | null>(null);
  const [scriptArgs, setScriptArgs] = useState<string>('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Load saved scripts on component mount
  useEffect(() => {
    fetchSavedScripts();
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (repeatTimer) {
        clearInterval(repeatTimer);
      }
    };
  }, [repeatTimer]);

  const fetchSavedScripts = async () => {
    try {
      const response = await fetch('http://localhost:8001/api/fs/saved-scripts');
      const data = await response.json();
      setSavedScripts(data);
    } catch (err) {
      console.error('Error loading saved scripts:', err);
    }
  };

  const handleRunScript = async () => {
    if (!selectedScript) return;

    setLoading(true);
    setError(null);
    setOutput('');
    setLastRunTime(new Date());
    
    // Create new AbortController for this execution
    const controller = new AbortController();
    setAbortController(controller);
    
    try {
      const response = await fetch('http://localhost:8001/api/fs/execute-script-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: selectedScript.name,
          body: selectedScript.body,
          args: scriptArgs
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const data = await response.json();
        const errorMessage = data.detail || 'Unknown error occurred';
        setError(errorMessage);
        setLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let currentData = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine === '') {
            // End of event, process it
            if (currentEvent && currentData) {
              console.log('Processing event:', currentEvent, currentData);
              // Unescape newlines and handle the data
              const unescapedData = currentData.replace(/\\n/g, '\n');
              if (currentEvent === 'output') {
                setOutput(prev => prev + unescapedData + '\n');
              } else if (currentEvent === 'error') {
                setError(prev => prev ? prev + '\n' + unescapedData : unescapedData);
              }
              currentEvent = '';
              currentData = '';
            }
            continue;
          }

          if (trimmedLine.startsWith('event: ')) {
            currentEvent = trimmedLine.slice(7);
          } else if (trimmedLine.startsWith('data: ')) {
            currentData = trimmedLine.slice(6);
          }
        }
      }

      // Process any remaining event
      if (currentEvent && currentData) {
        console.log('Processing final event:', currentEvent, currentData);
        const unescapedData = currentData.replace(/\\n/g, '\n');
        if (currentEvent === 'output') {
          setOutput(prev => prev + unescapedData + '\n');
        } else if (currentEvent === 'error') {
          setError(prev => prev ? prev + '\n' + unescapedData : unescapedData);
        }
      }

      setLoading(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Script execution cancelled');
      } else {
        console.error('Script execution error:', err);
        setError(err instanceof Error ? err.message : 'Failed to execute script');
      }
      setLoading(false);
    } finally {
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
      const script: SavedScript = {
        name: scriptName,
        description: scriptDescription,
        body: scriptBody
      };

      const response = await fetch('http://localhost:8001/api/fs/save-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(script),
      });

      if (response.ok) {
        await fetchSavedScripts();
        setSaveDialogOpen(false);
        setScriptName('');
        setScriptDescription('');
        setScriptBody('');
      }
    } catch (err) {
      console.error('Error saving script:', err);
    }
  };

  const handleDeleteScript = async (name: string) => {
    try {
      const response = await fetch(`http://localhost:8001/api/fs/saved-script/${name}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchSavedScripts();
      }
    } catch (err) {
      console.error('Error deleting script:', err);
    }
  };

  const handleEditScript = (script: SavedScript) => {
    setScriptName(script.name);
    setScriptDescription(script.description);
    setScriptBody(script.body);
    setSaveDialogOpen(true);
  };

  const formatLastRunTime = (date: Date) => {
    return date.toLocaleTimeString();
  };

  const handleScriptChange = (newScript: SavedScript | null) => {
    if (hasUnsavedChanges && selectedScript) {
      setPendingScript(newScript);
      setConfirmDialogOpen(true);
    } else {
      setSelectedScript(newScript);
      setHasUnsavedChanges(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedScript) return;

    try {
      const response = await fetch('http://localhost:8001/api/fs/save-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(selectedScript),
      });

      if (response.ok) {
        await fetchSavedScripts();
        setHasUnsavedChanges(false);
      }
    } catch (err) {
      console.error('Error saving script:', err);
    }
  };

  const handleConfirmDiscard = () => {
    setSelectedScript(pendingScript);
    setHasUnsavedChanges(false);
    setConfirmDialogOpen(false);
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

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Shell Scripts
      </Typography>

      {/* Script Selection */}
      <Box sx={{ mb: 3 }}>
        <Autocomplete
          options={Object.values(savedScripts)}
          getOptionLabel={(option) => option.name}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Select Script"
              placeholder="Search scripts..."
            />
          )}
          renderOption={(props, option) => (
            <li {...props}>
              <Box>
                <Typography variant="body1">{option.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.description}
                </Typography>
              </Box>
            </li>
          )}
          onChange={(_, value) => handleScriptChange(value)}
          value={selectedScript}
        />
      </Box>

      {/* Script Arguments */}
      <Box sx={{ mb: 3 }}>
        <TextField
          label="Arguments"
          value={scriptArgs}
          onChange={(e) => setScriptArgs(e.target.value)}
          placeholder="Enter script arguments..."
          fullWidth
          helperText="Arguments to pass to the script"
        />
      </Box>

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
            InputProps={{
              inputProps: { min: 1 }
            }}
            helperText={lastRunTime ? `Last run: ${formatLastRunTime(lastRunTime)}` : ''}
          />
          {repeatTimer && (
            <Typography variant="caption" color="text.secondary">
              Auto-repeat active
            </Typography>
          )}
        </Box>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
          <CircularProgress />
        </Box>
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

      {/* Script Editor */}
      {selectedScript && (
        <Box sx={{ mb: 3 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
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
          </Paper>
        </Box>
      )}

      {/* Save Script Dialog */}
      <Dialog 
        open={saveDialogOpen} 
        onClose={() => {
          setSaveDialogOpen(false);
          setScriptName('');
          setScriptDescription('');
          setScriptBody('');
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Save Script</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Script Name"
              fullWidth
              value={scriptName}
              onChange={(e) => setScriptName(e.target.value)}
            />
            <TextField
              label="Description"
              fullWidth
              value={scriptDescription}
              onChange={(e) => setScriptDescription(e.target.value)}
            />
            <TextField
              label="Script Body"
              multiline
              fullWidth
              rows={15}
              value={scriptBody}
              onChange={(e) => setScriptBody(e.target.value)}
              sx={{
                fontFamily: 'monospace',
                '& .MuiInputBase-input': {
                  fontFamily: 'monospace'
                }
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setSaveDialogOpen(false);
            setScriptName('');
            setScriptDescription('');
            setScriptBody('');
          }}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveScript}
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
            {Object.entries(savedScripts).map(([name, script]) => (
              <React.Fragment key={name}>
                <ListItem>
                  <ListItemText
                    primary={name}
                    secondary={script.description}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => handleDeleteScript(name)}
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

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialogOpen}
        onClose={handleCancelDiscard}
      >
        <DialogTitle>Unsaved Changes</DialogTitle>
        <DialogContent>
          <Typography>
            You have unsaved changes. Do you want to save them before switching scripts?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDiscard}>
            Cancel
          </Button>
          <Button onClick={handleConfirmDiscard} color="error">
            Discard Changes
          </Button>
          <Button 
            onClick={() => {
              handleSaveChanges();
              handleConfirmDiscard();
            }} 
            color="primary"
            variant="contained"
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default FilesystemOps; 