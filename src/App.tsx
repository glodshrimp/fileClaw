import React from 'react'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ProjectsPage from './pages/ProjectsPage'
import ProjectTrackerPage from './pages/ProjectTracker/ProjectTrackerPage'
import SystemsPage from './pages/SystemsPage'
import AccountsPage from './pages/AccountsPage'
import SettingsPage from './pages/SettingsPage'
import WorkspacePage from './pages/Workspace/WorkspacePage'
import { AppProvider } from './contexts/AppContext'
import { ThemeProvider } from './contexts/ThemeContext'

function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<ProjectsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/workspace/:projectId" element={<WorkspacePage />} />
              <Route path="/tracking" element={<ProjectTrackerPage />} />
              <Route path="/systems" element={<SystemsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/ssh" element={<div />} />
              <Route path="/chat" element={<div />} />
              <Route path="/settings" element={<SettingsPage />} />
              {/* Dynamic Plugin Routes */}
              {(window as any).AppPluginAPI?.routes?.map((r: any, idx: number) => (
                <Route key={`plugin-route-${idx}`} path={r.path} element={r.element} />
              ))}
            </Routes>
        </Layout>
      </Router>
    </AppProvider>
  </ThemeProvider>
  )
}

export default App
