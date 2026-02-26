import React from 'react';
import { Composition } from 'remotion';
import { TimelineComposition } from './TimelineComposition';
import type { TimelineProject } from '@mrdv2/shared';

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
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        timeline: {
          version: '1.0.0',
          project: { name: 'empty', width: 1920, height: 1080, fps: 30 },
          media_pool: [],
          tracks: [],
        } as TimelineProject,
      }}
      calculateMetadata={async ({ props }) => {
        const tl = props.timeline;
        if (!tl?.tracks?.length) return {};

        const fps = tl.project.fps || 30;
        let maxEnd = 0;
        for (const track of tl.tracks) {
          for (const clip of track.clips) {
            const clipEnd = clip.timeline_start_sec + clip.duration_sec;
            if (clipEnd > maxEnd) maxEnd = clipEnd;
          }
        }
        const durationInFrames = Math.max(Math.ceil(maxEnd * fps), Math.ceil(fps));

        return {
          durationInFrames,
          fps,
          width: tl.project.width || 1920,
          height: tl.project.height || 1080,
        };
      }}
    />
  );
};
