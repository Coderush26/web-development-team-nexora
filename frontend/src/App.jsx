import { useState } from 'react';
import { useFleetStore } from './store/fleetStore.js';
import LoginPage from './components/LoginPage.jsx';
import CommandView from './components/CommandView.jsx';
import CaptainView from './components/CaptainView.jsx';
import ToastContainer from './components/ToastContainer.jsx';

export default function App() {
  const role = useFleetStore(s => s.role);
  const toasts = useFleetStore(s => s.toasts);
  const dismissToast = useFleetStore(s => s.dismissToast);

  return (
    <>
      {!role && <LoginPage />}
      {role === 'command' && <CommandView />}
      {role === 'captain' && <CaptainView />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
