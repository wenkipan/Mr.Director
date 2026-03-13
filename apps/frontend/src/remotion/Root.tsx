import React from 'react';
import { Composition } from 'remotion';
import { TimelineComposition } from './TimelineComposition';
import type { TimelineProject } from '@mrdv2/shared';

// Placeholder defaults for the Composition component.
// Actual values come from timeline.project via calculateMetadata at render time.
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;

/**
 * Remotion Root for server-side rendering.
 * Props (timeline, durationInFrames, fps, width, height) are passed via --props JSON file.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MrDV2Export"
      component={TimelineComposition}
      durationInFrames={300}
      fps={DEFAULT_FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      defaultProps={{
        timeline: {
          version: '1.0.0',
          project: { name: 'empty', width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, fps: DEFAULT_FPS },
          media_pool: [],
          tracks: [],
        } as TimelineProject,
      }}
      calculateMetadata={async ({ props }) => {
        const tl = props.timeline;
        if (!tl?.tracks?.length) return {};

        const fps = tl.project.fps || DEFAULT_FPS;
        let maxEnd = 0;
        for (const track of tl.tracks) {
          for (const clip of track.clips) {
            const clipEnd = clip.timeline_end_sec;
            if (clipEnd > maxEnd) maxEnd = clipEnd;
          }
        }
        const durationInFrames = Math.max(Math.ceil(maxEnd * fps), Math.ceil(fps));

        return {
          durationInFrames,
          fps,
          width: tl.project.width || DEFAULT_WIDTH,
          height: tl.project.height || DEFAULT_HEIGHT,
        };
      }}
    />
  );
};
