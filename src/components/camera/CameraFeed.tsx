'use client';

import { useEffect, forwardRef } from 'react';
import { useCamera } from '@/hooks/useCamera';
import { Camera, AlertCircle, Loader2 } from 'lucide-react';

interface CameraFeedProps {
  className?: string;
  onVideoReady?: (video: HTMLVideoElement) => void;
  onError?: (error: string) => void;
}

export const CameraFeed = forwardRef<HTMLVideoElement, CameraFeedProps>(
  function CameraFeed({ className = '', onVideoReady, onError }, ref) {
    const { videoRef, isLoading, isReady, error, startCamera } = useCamera({
      facingMode: 'user',
      width: 1280,
      height: 720,
    });

    // Start camera on mount
    useEffect(() => {
      startCamera();
    }, [startCamera]);

    // Notify parent when video is ready
    useEffect(() => {
      if (isReady && videoRef.current && onVideoReady) {
        onVideoReady(videoRef.current);
      }
    }, [isReady, videoRef, onVideoReady]);

    // Notify parent of errors
    useEffect(() => {
      if (error && onError) {
        onError(error);
      }
    }, [error, onError]);

    // Sync refs
    useEffect(() => {
      if (ref && typeof ref === 'function') {
        ref(videoRef.current);
      } else if (ref) {
        ref.current = videoRef.current;
      }
    }, [ref, videoRef]);

    return (
      <div className={`relative overflow-hidden bg-black ${className}`}>
        {/* Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }} // Mirror for selfie mode
        />

        {/* Loading State */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900">
            <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
            <p className="mt-4 text-lg text-yellow-400">Starting camera...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 p-8">
            <AlertCircle className="h-16 w-16 text-red-400" />
            <p className="mt-4 text-center text-lg font-medium text-red-400">
              Camera Error
            </p>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400">
              {error}
            </p>
            <button
              onClick={() => startCamera()}
              className="mt-6 rounded-full bg-yellow-400 px-6 py-2 font-medium text-black transition-colors hover:bg-yellow-300"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Initial State (before loading) */}
        {!isLoading && !error && !isReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            <Camera className="h-16 w-16 text-gray-400" />
            <p className="mt-4 text-lg font-medium text-gray-400">
              Camera Feed
            </p>
          </div>
        )}

        {/* Viewfinder Corners */}
        <div className="pointer-events-none absolute inset-8">
          <div className="absolute left-0 top-0 h-8 w-8 border-l-2 border-t-2 border-yellow-400/50" />
          <div className="absolute right-0 top-0 h-8 w-8 border-r-2 border-t-2 border-yellow-400/50" />
          <div className="absolute bottom-0 left-0 h-8 w-8 border-b-2 border-l-2 border-yellow-400/50" />
          <div className="absolute bottom-0 right-0 h-8 w-8 border-b-2 border-r-2 border-yellow-400/50" />
        </div>
      </div>
    );
  }
);
