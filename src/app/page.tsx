'use client';

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { ModeToggle } from '@/components/ui/ModeToggle';
import { SettingsModal, HistoryModal } from '@/components/modals';
import { SigningView } from '@/components/views/SigningView';
import { ListeningView } from '@/components/views/ListeningView';

export default function Home() {
  const { mode } = useAppStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <AnimatePresence mode="wait">
        {mode === 'SIGNING' ? (
          <SigningView
            key="signing"
            onSettingsClick={() => setIsSettingsOpen(true)}
            onHistoryClick={() => setIsHistoryOpen(true)}
          />
        ) : (
          <ListeningView
            key="listening"
            onSettingsClick={() => setIsSettingsOpen(true)}
            onHistoryClick={() => setIsHistoryOpen(true)}
          />
        )}
      </AnimatePresence>

      {/* Bottom Control Bar - Fixed across both modes */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex h-[20vh] items-center justify-center bg-gradient-to-t from-black via-black/90 to-transparent">
        <ModeToggle />
      </div>

      {/* Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
}
