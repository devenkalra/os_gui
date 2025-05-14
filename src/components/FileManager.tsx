import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Alert,
  CircularProgress,
  TableSortLabel,
  Link,
  Backdrop,
} from '@mui/material';
import {
  CreateNewFolder as CreateFolderIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  ArrowUpward as ArrowUpwardIcon,
} from '@mui/icons-material';

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

interface FileListResponse {
  items: FileItem[];
  error: string | null;
  is_valid: boolean;
}

type SortField = 'name' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';

const FileManager = () => {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isNewFolderDialogOpen, setIsNewFolderDialogOpen] = useState(false);
  const [renameDialog, setRenameDialog] = useState({ open: false, item: null as FileItem | null, newName: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedPath, setDebouncedPath] = useState(currentPath);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [isNavigating, setIsNavigating] = useState(false);

  // Debounce path changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPath(currentPath);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [currentPath]);

  const fetchFiles = async (path: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`http://localhost:8001/api/files/list/${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.statusText}`);
      }
      const data: FileListResponse = await response.json();
      setFiles(data.items);
      
      if (data.error) {
        setError(data.error);
      } else if (data.items.length === 0) {
        setError('No files found in this directory');
      }
    } catch (error) {
      console.error('Error fetching files:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch files');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles(debouncedPath);
  }, [debouncedPath]);

  const handleCreateFolder = async () => {
    try {
      const newPath = `${currentPath}/${newFolderName}`;
      await fetch(`http://localhost:8001/api/files/create-dir/${encodeURIComponent(newPath)}`, {
        method: 'POST',
      });
      setIsNewFolderDialogOpen(false);
      setNewFolderName('');
      fetchFiles(currentPath);
    } catch (error) {
      console.error('Error creating folder:', error);
    }
  };

  const handleDelete = async (path: string) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      try {
        await fetch(`http://localhost:8001/api/files/delete/${encodeURIComponent(path)}`, {
          method: 'DELETE',
        });
        fetchFiles(currentPath);
      } catch (error) {
        console.error('Error deleting item:', error);
      }
    }
  };

  const handleRename = async () => {
    if (!renameDialog.item) return;
    try {
      const newPath = `${currentPath}/${renameDialog.newName}`;
      await fetch('http://localhost:8001/api/files/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          old_path: renameDialog.item.path,
          new_path: newPath,
        }),
      });
      setRenameDialog({ open: false, item: null, newName: '' });
      fetchFiles(currentPath);
    } catch (error) {
      console.error('Error renaming item:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    setIsSearching(true);
    try {
      const response = await fetch(
        `http://localhost:8001/api/files/search?directory=${encodeURIComponent(currentPath)}&pattern=${encodeURIComponent(searchQuery)}`
      );
      const data = await response.json();
      setSearchResults(data);
    } catch (error) {
      console.error('Error searching files:', error);
    }
    setIsSearching(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedFiles = [...files].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'size':
        comparison = a.size - b.size;
        break;
      case 'modified':
        comparison = a.modified - b.modified;
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleDirectoryClick = (path: string) => {
    // Ensure path starts with a slash
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    setCurrentPath(normalizedPath);
  };

  const handleParentFolder = async () => {
    // Handle root directory case
    if (currentPath === '/') return;
    
    setIsNavigating(true);
    
    try {
      // Split path and remove empty segments
      const segments = currentPath.split('/').filter(Boolean);
      
      // If we're in a subdirectory, go up one level
      if (segments.length > 0) {
        segments.pop();
        const parentPath = segments.length > 0 ? '/' + segments.join('/') : '/';
        setCurrentPath(parentPath);
      } else {
        // If we're in a root-level directory, go to root
        setCurrentPath('/');
      }
    } finally {
      // Wait for the next render cycle to ensure the path update is processed
      setTimeout(() => {
        setIsNavigating(false);
      }, 100);
    }
  };

  const handleCancelNavigation = () => {
    setIsNavigating(false);
  };

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
        <TextField
          label="Current Path"
          value={currentPath}
          onChange={(e) => {
            // Ensure path starts with a slash
            const newPath = e.target.value.startsWith('/') ? e.target.value : '/' + e.target.value;
            setCurrentPath(newPath);
          }}
          fullWidth
          error={!!error}
          helperText={error}
          disabled={isNavigating}
        />
        <Button
          variant="outlined"
          startIcon={<ArrowUpwardIcon />}
          onClick={handleParentFolder}
          disabled={currentPath === '/' || isNavigating}
          title="Go to parent directory"
        >
          Parent Folder
        </Button>
        <Button
          variant="contained"
          startIcon={<CreateFolderIcon />}
          onClick={() => setIsNewFolderDialogOpen(true)}
          disabled={isNavigating}
        >
          New Folder
        </Button>
      </Box>

      {/* Navigation Loading Backdrop */}
      <Backdrop
        sx={{
          color: '#fff',
          zIndex: (theme) => theme.zIndex.drawer + 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
        open={isNavigating}
      >
        <CircularProgress color="inherit" />
        <Typography variant="h6">Navigating to parent folder...</Typography>
        <Button
          variant="contained"
          color="error"
          onClick={handleCancelNavigation}
        >
          Cancel
        </Button>
      </Backdrop>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
          <CircularProgress />
        </Box>
      )}

      {error && !isLoading && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
        <TextField
          label="Search Files"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          fullWidth
          disabled={isNavigating}
        />
        <Button
          variant="contained"
          startIcon={<SearchIcon />}
          onClick={handleSearch}
          disabled={isSearching || isNavigating}
        >
          Search
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width="50%">
                <TableSortLabel
                  active={sortField === 'name'}
                  direction={sortField === 'name' ? sortDirection : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell width="15%">
                <TableSortLabel
                  active={sortField === 'size'}
                  direction={sortField === 'size' ? sortDirection : 'asc'}
                  onClick={() => handleSort('size')}
                >
                  Size
                </TableSortLabel>
              </TableCell>
              <TableCell width="25%">
                <TableSortLabel
                  active={sortField === 'modified'}
                  direction={sortField === 'modified' ? sortDirection : 'asc'}
                  onClick={() => handleSort('modified')}
                >
                  Modified
                </TableSortLabel>
              </TableCell>
              <TableCell width="10%">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(isSearching ? searchResults : sortedFiles).map((file) => (
              <TableRow 
                key={file.path}
                sx={{ 
                  cursor: file.is_dir && !isNavigating ? 'pointer' : 'default',
                  '&:hover': {
                    backgroundColor: file.is_dir && !isNavigating ? 'action.hover' : 'inherit'
                  },
                  opacity: isNavigating ? 0.7 : 1
                }}
              >
                <TableCell 
                  onClick={() => !isNavigating && file.is_dir && handleDirectoryClick(file.path)}
                  sx={{ 
                    maxWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    {file.is_dir ? (
                      <Link
                        component="button"
                        variant="body2"
                        onClick={(e) => {
                          if (isNavigating) return;
                          e.stopPropagation();
                          handleDirectoryClick(file.path);
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          textDecoration: 'none',
                          color: 'primary.main',
                          '&:hover': {
                            textDecoration: isNavigating ? 'none' : 'underline'
                          },
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          pointerEvents: isNavigating ? 'none' : 'auto'
                        }}
                      >
                        <FolderIcon color="primary" sx={{ flexShrink: 0 }} />
                        <Typography noWrap>{file.name}</Typography>
                      </Link>
                    ) : (
                      <>
                        <FileIcon sx={{ flexShrink: 0 }} />
                        <Typography noWrap>{file.name}</Typography>
                      </>
                    )}
                  </Box>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatFileSize(file.size)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(file.modified)}</TableCell>
                <TableCell>
                  <IconButton 
                    onClick={() => setRenameDialog({ open: true, item: file, newName: file.name })}
                    disabled={isNavigating}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton 
                    onClick={() => handleDelete(file.path)}
                    disabled={isNavigating}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* New Folder Dialog */}
      <Dialog open={isNewFolderDialogOpen} onClose={() => setIsNewFolderDialogOpen(false)}>
        <DialogTitle>Create New Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Folder Name"
            fullWidth
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsNewFolderDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateFolder} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialog.open} onClose={() => setRenameDialog({ open: false, item: null, newName: '' })}>
        <DialogTitle>Rename Item</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="New Name"
            fullWidth
            value={renameDialog.newName}
            onChange={(e) => setRenameDialog({ ...renameDialog, newName: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog({ open: false, item: null, newName: '' })}>Cancel</Button>
          <Button onClick={handleRename} variant="contained">
            Rename
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default FileManager; 