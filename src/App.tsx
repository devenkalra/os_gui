import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemIcon,
  ListItemText,
  useTheme,
  CssBaseline,
  ThemeProvider,
  createTheme,
} from '@mui/material';
import {
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  Folder as FolderIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import FileManager from './components/FileManager';
import FilesystemOps from './components/FilesystemOps';

const drawerWidth = 240;

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

function App() {
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('fileManager');
  const theme = useTheme();

  const handleDrawerToggle = () => {
    setOpen(!open);
  };

  const menuItems = [
    { text: 'File Manager', icon: <FolderIcon />, path: '/' },
    { text: 'Filesystem Operations', icon: <StorageIcon />, path: '/fs-ops' },
    { text: 'Image Processing', icon: <ImageIcon />, path: '/images' },
    { text: 'Video Processing', icon: <VideoIcon />, path: '/videos' },
  ];

  return (
    <Router>
      <Box sx={{ display: 'flex' }}>
        <AppBar position="fixed" sx={{ zIndex: theme.zIndex.drawer + 1 }}>
          <Toolbar>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              onClick={handleDrawerToggle}
              edge="start"
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" noWrap component="div">
              OS Services UI
            </Typography>
          </Toolbar>
        </AppBar>
        <Drawer
          variant="permanent"
          open={open}
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              ...(open ? {} : { width: theme.spacing(7) }),
            },
          }}
        >
          <Toolbar />
          <Box sx={{ overflow: 'auto' }}>
            <List>
              {menuItems.map((item) => (
                <ListItem button key={item.text} component={Link} to={item.path}>
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.text} />
                </ListItem>
              ))}
            </List>
          </Box>
        </Drawer>
        <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
          <Toolbar />
          <Routes>
            <Route path="/" element={<FileManager />} />
            <Route path="/fs-ops" element={<FilesystemOps />} />
            <Route path="/images" element={<div>Image Processing (Coming Soon)</div>} />
            <Route path="/videos" element={<div>Video Processing (Coming Soon)</div>} />
          </Routes>
        </Box>
      </Box>
    </Router>
  );
}

export default App; 