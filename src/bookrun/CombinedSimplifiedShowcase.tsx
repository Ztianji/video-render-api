import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Sequence, CalculateMetadataFunction, Audio, Img, staticFile, getRemotionEnvironment } from "remotion";
import { getAudioData, getVideoMetadata } from '@remotion/media-utils';
import { z } from 'zod';
import { SimplifiedShowcase } from './SimplifiedShowcase';

// 单个片段的配置 schema
const showcaseSegmentSchema = z.object({
  cameraEffects: z.string(),
  speaker_audio: z.array(z.string()),
  subtitles: z.array(z.string()),
  backgroundImages: z.array(z.string()).optional(), // 改为数组，支持图片和视频混合
  font_style: z.string(),
});

// 组合模板的属性 schema
export const combinedSimplifiedShowcaseSchema = z.object({
  segments: z.array(showcaseSegmentSchema),
  backgroundMusic: z.array(z.string()).optional(), // 添加背景音乐数组
  coverImageUrl: z.string().optional(), // 封面图片URL
  episodeNumber: z.number().optional(), // 集数编号
});

// 从 schema 推导类型
export type CombinedSimplifiedShowcaseProps = z.infer<typeof combinedSimplifiedShowcaseSchema>;

const HTTP_PROTOCOL_REGEX = /^https?:\/\//i;

const sanitizeFileName = (fileName: string) =>
  decodeURIComponent(fileName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');

const extractFileName = (url: string) => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lastSlashIndex = pathname.lastIndexOf('/');
    const raw = lastSlashIndex >= 0 ? pathname.slice(lastSlashIndex + 1) : pathname;
    return raw ? sanitizeFileName(raw) : null;
  } catch {
    const parts = url.split('/');
    const raw = parts[parts.length - 1];
    return raw ? sanitizeFileName(raw) : null;
  }
};

type ProxyFolder = 'audio' | 'background';

const resolveMediaUrl = (url: string, folder: ProxyFolder, isStudio: boolean) => {
  if (!isStudio) {
    return url;
  }

  if (!HTTP_PROTOCOL_REGEX.test(url)) {
    return url;
  }

  const fileName = extractFileName(url);

  if (!fileName) {
    return url;
  }

  return staticFile(`preview/${folder}/${fileName}`);
};

const resolveSegmentsForEnvironment = (
  segments: CombinedSimplifiedShowcaseProps['segments'],
  isStudio: boolean,
) => {
  if (!isStudio) {
    return segments;
  }

  return segments.map((segment) => ({
    ...segment,
    speaker_audio: segment.speaker_audio.map((audioUrl) =>
      resolveMediaUrl(audioUrl, 'audio', isStudio),
    ),
    backgroundImages: segment.backgroundImages
      ? segment.backgroundImages.map((mediaUrl) =>
          resolveMediaUrl(mediaUrl, 'background', isStudio),
        )
      : segment.backgroundImages,
  }));
};

const resolveBackgroundMusicForEnvironment = (
  backgroundMusic: string[],
  isStudio: boolean,
) => {
  if (!isStudio) {
    return backgroundMusic;
  }

  return backgroundMusic.map((musicUrl) => resolveMediaUrl(musicUrl, 'audio', isStudio));
};

export const CombinedSimplifiedShowcase: React.FC<CombinedSimplifiedShowcaseProps> = ({
  segments = [],
  backgroundMusic = [],
  coverImageUrl,
  episodeNumber,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isStudio } = getRemotionEnvironment();
  const backgroundColor = "#000000";

  const resolvedSegments = useMemo(
    () => resolveSegmentsForEnvironment(segments, isStudio),
    [segments, isStudio],
  );

  const resolvedBackgroundMusic = useMemo(
    () => resolveBackgroundMusicForEnvironment(backgroundMusic, isStudio),
    [backgroundMusic, isStudio],
  );
  
  // 封面只显示第一帧，片段从第二帧开始
  const coverDurationInFrames = (coverImageUrl || episodeNumber) ? 1 : 0;
  
  // 存储每个片段的音频时长信息
  const [segmentDurations, setSegmentDurations] = useState<number[]>([]);
  const [backgroundMusicDurations, setBackgroundMusicDurations] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 异步获取所有片段时长
  useEffect(() => {
    const loadAllSegmentData = async () => {
      const durations: number[] = [];

      for (const segment of resolvedSegments) {
        let segmentTotalDuration = 0;

        // 优先使用音频时长
        if (segment.speaker_audio && segment.speaker_audio.length > 0) {
          // 计算每个片段中所有音频的总时长
          for (const audioUrl of segment.speaker_audio) {
            try {
              const audioData = await getAudioData(audioUrl);
              segmentTotalDuration += audioData.durationInSeconds;
            } catch (error) {
              console.warn(`Failed to load audio data for ${audioUrl}:`, error);
              // 如果音频加载失败，使用默认时长3秒
              segmentTotalDuration += 3;
            }
          }
        } else if (segment.backgroundImages && segment.backgroundImages.length > 0) {
          // 如果没有音频，使用背景媒体时长
          for (const mediaUrl of segment.backgroundImages) {
            try {
              const mediaType = getMediaType(mediaUrl);

              if (mediaType === 'video') {
                const videoData = await getVideoMetadata(mediaUrl);
                segmentTotalDuration += videoData.durationInSeconds;
              } else {
                // 图片默认5秒
                segmentTotalDuration += 5;
              }
            } catch (error) {
              console.warn(`Failed to load media metadata for ${mediaUrl}:`, error);
              // 如果媒体加载失败，使用默认时长
              segmentTotalDuration += getMediaType(mediaUrl) === 'video' ? 3 : 5;
            }
          }
        } else {
          // 如果既没有音频也没有背景媒体，使用默认时长5秒
          segmentTotalDuration = 5;
        }
        
        // 确保每个片段至少有1秒时长
        segmentTotalDuration = Math.max(segmentTotalDuration, 1);
        durations.push(segmentTotalDuration);
      }
      
      // 获取背景音乐时长
      const bgMusicDurations: number[] = [];
      for (const musicUrl of resolvedBackgroundMusic) {
        try {
          const audioData = await getAudioData(musicUrl);
          bgMusicDurations.push(audioData.durationInSeconds);
        } catch (error) {
          console.warn(`Failed to load background music data for ${musicUrl}:`, error);
          // 如果背景音乐加载失败，使用默认时长30秒
          bgMusicDurations.push(30);
        }
      }
      
      setSegmentDurations(durations);
      setBackgroundMusicDurations(bgMusicDurations);
      setIsLoading(false);
    };
    
    if (resolvedSegments.length > 0) {
      loadAllSegmentData();
    } else {
      setIsLoading(false);
    }
  }, [resolvedSegments, resolvedBackgroundMusic]);

  // 如果还在加载，使用默认时长
  const effectiveSegmentDurations = isLoading
    ? resolvedSegments.map(() => 5) // 每个片段默认5秒
    : segmentDurations.length > 0 ? segmentDurations : resolvedSegments.map(() => 5);
  
  // 计算每个片段的开始帧（在封面结束后开始）
  const segmentStartFrames = effectiveSegmentDurations.reduce((acc, duration, index) => {
    if (index === 0) {
      // 第一个片段从封面结束后开始
      acc.push(coverDurationInFrames);
    } else {
      // 当前片段开始帧 = 前一个片段开始帧 + 前一个片段时长（无间隔）
      const previousStart = acc[index - 1];
      const previousDuration = effectiveSegmentDurations[index - 1] * fps;
      acc.push(previousStart + previousDuration);
    }
    return acc;
  }, [] as number[]);
  
  // 计算总时长（无需包含封面时长，因为封面只显示1帧）
  const totalDuration = effectiveSegmentDurations.reduce((sum, duration) => sum + duration, 0);
  
  // 计算背景音乐的播放逻辑
  const generateBackgroundMusicSequences = () => {
    if (resolvedBackgroundMusic.length === 0 || backgroundMusicDurations.length === 0) {
      return [];
    }

    const totalDurationInFrames = totalDuration * fps;
    const sequences = [];
    let currentFrame = 0;
    let musicIndex = 0;

    while (currentFrame < totalDurationInFrames) {
      const currentMusicDuration = backgroundMusicDurations[musicIndex];
      const durationInFrames = Math.min(
        currentMusicDuration * fps,
        totalDurationInFrames - currentFrame
      );

      sequences.push({
        musicUrl: resolvedBackgroundMusic[musicIndex],
        startFrame: currentFrame,
        durationInFrames: durationInFrames,
        volume: 0.3 // 背景音乐音量调低
      });

      currentFrame += durationInFrames;

      // 如果只有一个背景音乐，一直循环同一个
      if (resolvedBackgroundMusic.length === 1) {
        musicIndex = 0;
      } else {
        // 多个背景音乐按顺序循环
        musicIndex = (musicIndex + 1) % resolvedBackgroundMusic.length;
      }
    }

    return sequences;
  };
  
  // 找到当前播放的片段
  const getCurrentSegmentIndex = () => {
    // 如果是第一帧（封面），返回-1
    if (frame === 0) {
      return -1;
    }
    
    for (let i = 0; i < segmentStartFrames.length; i++) {
      const segmentStart = segmentStartFrames[i];
      const segmentEnd = segmentStart + effectiveSegmentDurations[i] * fps;
      
      if (frame >= segmentStart && frame < segmentEnd) {
        return i;
      }
    }
    return segmentStartFrames.length - 1;
  };
  
  const currentSegmentIndex = getCurrentSegmentIndex();
  const backgroundMusicSequences = generateBackgroundMusicSequences();

  return (
    <AbsoluteFill style={{ 
      background: backgroundColor,
      overflow: 'hidden'
    }}>
      {/* 封面和集数显示 - 只在第一帧显示 */}
      {frame === 0 && (coverImageUrl || episodeNumber) && (
        <AbsoluteFill style={{
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* 封面图片背景 */}
          {coverImageUrl && (
            <Img
              src={coverImageUrl}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                zIndex: 1,
              }}
              alt="封面"
            />
          )}
          
          {/* 集数数字 */}
          {episodeNumber && (
            <div style={{
              position: 'relative',
              zIndex: 3,
              fontSize: '180px',
              fontWeight: 'bold',
              color: '#FFA500', // 橘黄色
              filter: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.7))',
              textShadow: `
                0 0 10px rgba(0, 0, 0, 0.3),
                0 0 20px rgba(0, 0, 0, 0.2),
                0 0 30px rgba(255, 255, 255, 0.3),
                0 0 40px rgba(255, 255, 255, 0.2)
              `,
              padding: '20px 40px',
              fontFamily: '"WenQuanYi Micro Hei", "文泉驿微米黑", "Noto Sans CJK SC", "思源黑体", "Droid Sans Fallback", sans-serif',
              borderRadius: '10px',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
            }}>
              {episodeNumber}
            </div>
          )}
        </AbsoluteFill>
      )}

      {/* 背景音乐播放 */}
      {backgroundMusicSequences.map((bgMusic, index) => (
        <Sequence
          key={`bg-music-${index}`}
          from={bgMusic.startFrame}
          durationInFrames={bgMusic.durationInFrames}
        >
          <Audio
            src={bgMusic.musicUrl}
            volume={() => bgMusic.volume}
          />
        </Sequence>
      ))}
      
      {/* 渲染所有片段（无缝连接） */}
      {resolvedSegments.map((segment, index) => {
        const startFrame = segmentStartFrames[index];
        const durationInFrames = effectiveSegmentDurations[index] * fps;

        return (
          <Sequence
            key={`segment-${index}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <SimplifiedShowcase
              cameraEffects={segment.cameraEffects}
              speaker_audio={segment.speaker_audio}
              subtitles={segment.subtitles}
              backgroundImages={segment.backgroundImages}
              font_style={segment.font_style}
            />
          </Sequence>
        );
      })}
      
      {/* 调试信息 (可选，生产环境可删除) */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{
          position: 'absolute',
          top: 20,
          right: 20,
          color: 'white',
          fontSize: 14,
          backgroundColor: 'rgba(0,0,0,0.7)',
          padding: '10px',
          borderRadius: '4px',
          zIndex: 100,
          textAlign: 'right',
        }}>
          <div>当前帧: {frame}</div>
          <div>封面: {(coverImageUrl || episodeNumber) ? '第一帧显示' : '无'}</div>
          <div>总片段数: {resolvedSegments.length}</div>
          <div>背景音乐数: {resolvedBackgroundMusic.length}</div>
          {currentSegmentIndex === -1 ? (
            <div>当前显示: 封面</div>
          ) : (
            <>
              <div>当前片段: {currentSegmentIndex + 1}/{resolvedSegments.length}</div>
              <div>当前片段时长: {effectiveSegmentDurations[currentSegmentIndex]?.toFixed(1) || 0}秒</div>
            </>
          )}
          <div>总时长: {totalDuration.toFixed(1)}秒{isLoading ? ' (使用默认值)' : ''}</div>
          {currentSegmentIndex >= 0 && resolvedSegments[currentSegmentIndex] && (
            <>
              <div>运镜效果: {resolvedSegments[currentSegmentIndex].cameraEffects}</div>
              <div>字体样式: {resolvedSegments[currentSegmentIndex].font_style}</div>
              <div>音频数量: {resolvedSegments[currentSegmentIndex].speaker_audio.length}</div>
              <div>背景媒体数量: {resolvedSegments[currentSegmentIndex].backgroundImages?.length || 0}</div>
              {resolvedSegments[currentSegmentIndex].backgroundImages && resolvedSegments[currentSegmentIndex].backgroundImages!.length > 0 && (
                <div>当前背景: {resolvedSegments[currentSegmentIndex].backgroundImages![0].split('/').pop()}</div>
              )}
            </>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
}; 

// 工具函数：根据URL判断是图片还是视频
const getMediaType = (url: string): 'image' | 'video' => {
  const lowerUrl = url.toLowerCase();
  
  // 定义图片和视频的扩展名和标识符
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
  const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'flv', 'wmv'];
  
  // 1. 检查URL中是否包含视频格式标识
  for (const ext of videoExtensions) {
    if (lowerUrl.includes(`.${ext}`)) {
      return 'video';
    }
  }
  
  // 2. 检查URL中是否包含图片格式标识
  for (const ext of imageExtensions) {
    if (lowerUrl.includes(`.${ext}`)) {
      return 'image';
    }
  }
  
  // 3. 检查查询参数中的format参数
  try {
    const urlObj = new URL(url);
    const format = urlObj.searchParams.get('format');
    if (format) {
      const formatExt = format.replace('.', '').toLowerCase();
      if (videoExtensions.includes(formatExt)) {
        return 'video';
      }
      if (imageExtensions.includes(formatExt)) {
        return 'image';
      }
    }
  } catch {
    // URL解析失败，继续其他判断
  }
  
  // 4. 根据URL路径和关键词进行推断
  if (lowerUrl.includes('video') || 
      lowerUrl.includes('movie') || 
      lowerUrl.includes('film') ||
      lowerUrl.includes('media') && lowerUrl.includes('mp4')) {
    return 'video';
  }
  
  if (lowerUrl.includes('image') || 
      lowerUrl.includes('img') || 
      lowerUrl.includes('photo') ||
      lowerUrl.includes('picture') ||
      lowerUrl.includes('jpeg') ||
      lowerUrl.includes('png')) {
    return 'image';
  }
  
  // 5. 检查特定的CDN或服务域名模式
  if (lowerUrl.includes('dreamina') || 
      lowerUrl.includes('byteimg') ||
      lowerUrl.includes('aigc_resize')) {
    return 'image';
  }
  
  if (lowerUrl.includes('doubao-seedance') ||
      lowerUrl.includes('content-generation') ||
      lowerUrl.includes('tos-cn-beijing') && lowerUrl.includes('mp4')) {
    return 'video';
  }
  
  // 默认返回图片（保守策略）
  return 'image';
};

// 在文件末尾添加 calculateMetadata 函数
export const calculateMetadata: CalculateMetadataFunction<CombinedSimplifiedShowcaseProps> = async ({ props }) => {
  const { segments = [] } = props;
  const { isStudio } = getRemotionEnvironment();
  const resolvedSegments = resolveSegmentsForEnvironment(segments, isStudio);

  if (resolvedSegments.length === 0) {
    // 如果没有片段，返回默认时长
    return {
      durationInFrames: 150, // 5秒默认时长
      fps: 30,
      width: 1080,
      height: 1920,
    };
  }
  
  console.log(`CombinedSimplifiedShowcase calculateMetadata: Processing ${resolvedSegments.length} segments`);

  // 计算所有片段的总时长
  let totalDurationInSeconds = 0;

  for (let i = 0; i < resolvedSegments.length; i++) {
    const segment = resolvedSegments[i];
    let segmentTotalDuration = 0;

    console.log(`CombinedSimplifiedShowcase calculateMetadata: Processing segment ${i + 1}/${resolvedSegments.length}`);

    try {
      // 优先使用音频时长
      if (segment.speaker_audio && segment.speaker_audio.length > 0) {
        console.log(`  - Segment ${i + 1}: Found ${segment.speaker_audio.length} audio files`);
        // 计算每个片段中所有音频的总时长
        for (const audioUrl of segment.speaker_audio) {
          try {
            const audioData = await getAudioData(audioUrl);
            segmentTotalDuration += audioData.durationInSeconds;
            console.log(`    - Audio duration: ${audioData.durationInSeconds}s`);
          } catch (error) {
            console.warn(`    - Failed to load audio data for ${audioUrl}:`, error);
            // 如果音频加载失败，使用默认时长3秒
            segmentTotalDuration += 3;
            console.log(`    - Using default audio duration: 3s`);
          }
        }
      } else if (segment.backgroundImages && segment.backgroundImages.length > 0) {
        console.log(`  - Segment ${i + 1}: Found ${segment.backgroundImages.length} background media, no audio`);
        // 如果没有音频，使用背景媒体时长
        for (const mediaUrl of segment.backgroundImages) {
          try {
            const mediaType = getMediaType(mediaUrl);

            if (mediaType === 'video') {
              const videoData = await getVideoMetadata(mediaUrl);
              segmentTotalDuration += videoData.durationInSeconds;
              console.log(`    - Video duration: ${videoData.durationInSeconds}s`);
            } else {
              // 图片默认5秒
              segmentTotalDuration += 5;
              console.log(`    - Image duration: 5s (default)`);
            }
          } catch (error) {
            console.warn(`    - Failed to load media metadata for ${mediaUrl}:`, error);
            // 如果媒体加载失败，使用默认时长
            const defaultDuration = getMediaType(mediaUrl) === 'video' ? 3 : 5;
            segmentTotalDuration += defaultDuration;
            console.log(`    - Using default media duration: ${defaultDuration}s`);
          }
        }
      } else {
        // 如果既没有音频也没有背景媒体，使用默认时长5秒
        console.log(`  - Segment ${i + 1}: No audio or background media, using default duration`);
        segmentTotalDuration = 5;
      }
      
      // 确保每个片段至少有1秒时长
      segmentTotalDuration = Math.max(segmentTotalDuration, 1);
      console.log(`  - Segment ${i + 1}: Final duration: ${segmentTotalDuration}s`);
      totalDurationInSeconds += segmentTotalDuration;
      
    } catch (error) {
      console.error(`  - Error processing segment ${i + 1}:`, error);
      // 出现任何错误时，使用默认时长5秒
      segmentTotalDuration = 5;
      totalDurationInSeconds += segmentTotalDuration;
      console.log(`  - Segment ${i + 1}: Using fallback duration: 5s`);
    }
  }
  
  const fps = 30;
  
  // 确保总时长至少为1秒
  const finalDurationInSeconds = Math.max(totalDurationInSeconds, 1);
  
  console.log(`CombinedSimplifiedShowcase calculateMetadata: Total duration: ${totalDurationInSeconds}s -> Final: ${finalDurationInSeconds}s`);
  console.log(`CombinedSimplifiedShowcase calculateMetadata: Duration in frames: ${Math.ceil(finalDurationInSeconds * fps)} (${fps} fps)`);
  
  // 作为最后的安全措施，如果计算出的时长仍然为0或者太小，使用固定的默认值
  const safeDurationInFrames = Math.max(Math.ceil(finalDurationInSeconds * fps), 150); // 至少5秒
  
  return {
    durationInFrames: safeDurationInFrames,
    fps,
    width: 1080,
    height: 1920,
  };
}; 