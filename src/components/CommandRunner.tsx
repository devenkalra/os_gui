import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Autocomplete,
  IconButton,
  FormControlLabel,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  Divider,
} from '@mui/material';
import { PlayArrow as RunIcon, Refresh as RefreshIcon } from '@mui/icons-material';

interface ScriptMeta {
  id: number;
  name: string;
  description: string;
  category: string;
  working_dir?: string;
}

interface ScriptArgHistory {
  args: string;
  working_dir?: string;
}

interface HistoryItem {
  args: string;
  working_dir: string;
}

const CommandRunner: React.FC = () => {
  const [lastResult, setLastResult] = useState<string>('');
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [selectedScript, setSelectedScript] = useState<ScriptMeta | null>(null);
  const [args, setArgs] = useState('');
  const [argHistory, setArgHistory] = useState<string[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [workingDir, setWorkingDir] = useState('');
  const [history, setHistory] = useState<{ script: string; args: string }[]>([]);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acceptsReference, setAcceptsReference] = useState(false);

  const fetchLastResult = async () => {
    try {
      const resp = await fetch('http://localhost:8001/api/fs/get_last_result');
      if (resp.ok) {
        const data = await resp.json();
        setLastResult(data.text || '');
      }
    } catch (e) {
      console.error('Failed to load last result', e);
    }
  };

  const fetchScripts = async () => {
    try {
      const resp = await fetch('http://localhost:8001/api/fs/scripts');
      if (resp.ok) {
        const data = await resp.json();
        setScripts(data.scripts || []);
      }
    } catch (e) {
      console.error('Failed to load scripts', e);
    }
  };

  useEffect(() => {
    fetchLastResult();
    fetchScripts();
  }, []);

  useEffect(() => {
    const loadArgs = async () => {
      if (!selectedScript) {
        setArgHistory([]);
        setHistoryItems([]);
        setArgs('');
        setWorkingDir('');
        return;
      }
      try {
        const resp = await fetch(`http://localhost:8001/api/fs/scripts/${selectedScript.name}/args`);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.args)) {
            const historyItems = data.args as ScriptArgHistory[];
            // Extract just the args strings for the history dropdown
            const argsList = historyItems.map((item: ScriptArgHistory) => item.args || '');
            setArgHistory(argsList);
            setHistoryItems(historyItems.map(item => ({
              args: item.args || '',
              working_dir: item.working_dir || ''
            })));
            
            // Set the most recent args and working directory
            if (historyItems.length > 0) {
              setArgs(historyItems[0].args || '');
              setWorkingDir(historyItems[0].working_dir || '');
            } else {
              setArgs('');
              setWorkingDir('');
            }
          }
        }
      } catch (e) {
        console.error('Failed to load arg history', e);
      }
    };
    loadArgs();
  }, [selectedScript]);

  const handleArgsChange = (value: string | null) => {
    if (!value) {
      setArgs('');
      setWorkingDir('');
      return;
    }
    
    // Find matching history item
    const historyItem = historyItems.find(item => item.args === value);
    if (historyItem) {
      setArgs(historyItem.args);
      setWorkingDir(historyItem.working_dir);
    } else {
      setArgs(value);
    }
  };

  const handleWorkingDirChange = (value: string | null) => {
    if (!value) {
      setWorkingDir('');
      return;
    }
    
    // Find matching history item
    const historyItem = historyItems.find(item => item.working_dir === value);
    if (historyItem) {
      setArgs(historyItem.args);
      setWorkingDir(historyItem.working_dir);
    } else {
      setWorkingDir(value);
    }
  };

  const runCommand = async (scriptName: string, scriptArgs: string) => {
    setLoading(true);
    setOutput('');
    setError(null);

    setHistory((prev) => [{ script: scriptName, args: scriptArgs }, ...prev.slice(0, 9)]);

    try {
      const resp = await fetch('http://localhost:8001/api/fs/execute-script-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: scriptName, 
          args: scriptArgs,
          working_dir: workingDir || undefined
        }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentOut = '';
      let currentErr = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          const [eventLine, dataLine] = chunk.split('\n');
          if (!eventLine || !dataLine) continue;
          const eventType = eventLine.replace('event: ', '').trim();
          const payload = dataLine.replace('data: ', '').replace(/\\n/g, '\n');
          if (eventType === 'output') {
            currentOut += payload;
            setOutput(currentOut);
          } else if (eventType === 'error') {
            currentErr += payload;
            setError(currentErr);
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      fetchLastResult();
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Command Runner
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle1">Last Result</Typography>
          <IconButton size="small" onClick={fetchLastResult}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Box>
        <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
          {lastResult || 'No result available.'}
        </Typography>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Autocomplete
          options={scripts}
          getOptionLabel={(opt) => opt.name}
          sx={{ flex: 1 }}
          value={selectedScript}
          onChange={(_, v) => setSelectedScript(v)}
          renderInput={(params) => <TextField {...params} label="Select Command" />}
        />
        <Autocomplete
          freeSolo
          options={argHistory}
          value={args}
          onChange={(_, val) => handleArgsChange(val)}
          onInputChange={(_, val) => handleArgsChange(val)}
          sx={{ flex: 2 }}
          renderInput={(params) => <TextField {...params} label="Args" />}
        />
        <Autocomplete
          freeSolo
          options={historyItems.map(item => item.working_dir)}
          value={workingDir}
          onChange={(_, val) => handleWorkingDirChange(val)}
          onInputChange={(_, val) => handleWorkingDirChange(val)}
          sx={{ flex: 2 }}
          renderInput={(params) => <TextField {...params} label="Working Directory" placeholder="Leave empty to use current directory" />}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={acceptsReference}
              onChange={(e) => setAcceptsReference(e.target.checked)}
            />
          }
          label="Accepts Reference"
          sx={{ alignSelf: 'center' }}
        />
        <Button
          variant="contained"
          disabled={!selectedScript || loading}
          startIcon={<RunIcon />}
          onClick={() => selectedScript && runCommand(selectedScript.name, args)}
        >
          {loading ? 'Running...' : 'Run'}
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <CircularProgress size={20} sx={{ mr: 1 }} />
          <Typography>Running...</Typography>
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Paper sx={{ p: 2, mb: 2, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{output}</Paper>

      {/* History */}
      <Typography variant="h6">History (this session)</Typography>
      <List>
        {history.map((h, idx) => (
          <React.Fragment key={idx}>
            <ListItem button onClick={() => runCommand(h.script, h.args)}>
              <ListItemText primary={`${h.script} ${h.args}`} />
            </ListItem>
            <Divider />
          </React.Fragment>
        ))}
      </List>
    </Box>
  );
};

export default CommandRunner; 