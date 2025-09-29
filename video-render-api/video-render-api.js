import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { bundle } from "@remotion/bundler";
import { renderMedia, getCompositions } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import { setTimeout } from 'timers';

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 任务队列和状态管理
class TaskQueue {
  constructor() {
    this.tasks = new Map(); // 存储任务信息
    this.queue = []; // 待处理任务队列
    this.isProcessing = false; // 是否正在处理任务
    this.propsTemplates = new Map(); // 存储props模板
    
    // 持久化配置
    this.dataDir = "./data";
    this.tasksFile = path.join(this.dataDir, "tasks.json");
    this.templatesFile = path.join(this.dataDir, "templates.json");
    
    // 初始化时加载数据
    this.initializeStorage();
    this.loadTasks();
    this.loadTemplates();
  }

  // 初始化存储目录
  initializeStorage() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      console.log(`📁 创建数据目录: ${this.dataDir}`);
    }
  }

  // 保存任务到本地文件
  saveTasks() {
    try {
      const tasksData = {
        tasks: Array.from(this.tasks.entries()),
        queue: this.queue,
        lastUpdated: new Date().toISOString()
      };
      
      fs.writeFileSync(this.tasksFile, JSON.stringify(tasksData, null, 2));
      console.log(`💾 任务数据已保存到本地`);
    } catch (error) {
      console.error(`❌ 保存任务数据失败:`, error.message);
    }
  }

  // 从本地文件加载任务
  loadTasks() {
    try {
      if (fs.existsSync(this.tasksFile)) {
        const data = fs.readFileSync(this.tasksFile, 'utf8');
        const tasksData = JSON.parse(data);
        
        // 恢复任务数据，处理日期对象
        this.tasks = new Map(tasksData.tasks.map(([id, task]) => [
          id, 
          {
            ...task,
            createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
            startedAt: task.startedAt ? new Date(task.startedAt) : null,
            completedAt: task.completedAt ? new Date(task.completedAt) : null
          }
        ]));
        
        // 恢复队列，但排除已完成或失败的任务
        this.queue = tasksData.queue.filter(taskId => {
          const task = this.tasks.get(taskId);
          return task && (task.status === 'pending' || task.status === 'processing');
        });
        
        // 重置正在处理的任务状态
        for (const [taskId, task] of this.tasks) {
          if (task.status === 'processing') {
            task.status = 'pending';
            task.progress = 0;
            task.startedAt = null;
            this.tasks.set(taskId, task);
            console.log(`🔄 重置任务状态: ${taskId} (processing -> pending)`);
          }
        }
        
        console.log(`📂 已加载 ${this.tasks.size} 个任务记录`);
        console.log(`📋 队列中有 ${this.queue.length} 个待处理任务`);
        
        // 如果有待处理任务，启动处理
        if (this.queue.length > 0 && !this.isProcessing) {
          console.log(`🚀 发现待处理任务，重新启动处理队列`);
          setTimeout(() => this.processNextTask(), 2000);
        }
      }
    } catch (error) {
      console.error(`❌ 加载任务数据失败:`, error.message);
      console.log(`🆕 将使用空的任务队列`);
    }
  }

  // 保存模板到本地文件
  saveTemplates() {
    try {
      const templatesData = {
        templates: Array.from(this.propsTemplates.entries()),
        lastUpdated: new Date().toISOString()
      };
      
      fs.writeFileSync(this.templatesFile, JSON.stringify(templatesData, null, 2));
      console.log(`💾 模板数据已保存到本地`);
    } catch (error) {
      console.error(`❌ 保存模板数据失败:`, error.message);
    }
  }

  // 从本地文件加载模板
  loadTemplates() {
    try {
      if (fs.existsSync(this.templatesFile)) {
        const data = fs.readFileSync(this.templatesFile, 'utf8');
        const templatesData = JSON.parse(data);
        
        // 恢复模板数据，处理日期对象
        this.propsTemplates = new Map(templatesData.templates.map(([id, template]) => [
          id,
          {
            ...template,
            createdAt: template.createdAt ? new Date(template.createdAt) : new Date(),
            updatedAt: template.updatedAt ? new Date(template.updatedAt) : new Date()
          }
        ]));
        
        console.log(`📂 已加载 ${this.propsTemplates.size} 个模板`);
      }
    } catch (error) {
      console.error(`❌ 加载模板数据失败:`, error.message);
      console.log(`🆕 将使用空的模板集合`);
    }
  }

  // 更新任务状态并自动保存
  updateTaskStatus(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (task) {
      Object.assign(task, updates);
      this.tasks.set(taskId, task);
      
      // 自动保存到本地
      this.saveTasks();
    }
    return task;
  }

  // 添加任务到队列
  addTask(taskConfig) {
    const taskId = uuidv4();
    const task = {
      id: taskId,
      status: 'pending', // pending, processing, completed, failed
      progress: 0,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      config: taskConfig,
      outputPath: null,
      outputFileName: null,
      error: null
    };

    this.tasks.set(taskId, task);
    this.queue.push(taskId);
    
    // 自动保存到本地
    this.saveTasks();
    
    console.log(`📝 新任务已添加到队列: ${taskId}`);
    console.log(`📊 当前队列长度: ${this.queue.length}`);
    
    // 如果当前没有正在处理的任务，开始处理
    if (!this.isProcessing) {
      this.processNextTask();
    }

    return taskId;
  }

  // 获取任务信息
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  // 获取所有任务信息
  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  // Props模板管理方法
  savePropsTemplate(templateName, props, description = '') {
    const templateId = uuidv4();
    const template = {
      id: templateId,
      name: templateName,
      props,
      description,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.propsTemplates.set(templateId, template);
    
    // 自动保存模板到本地
    this.saveTemplates();
    
    console.log(`💾 Props模板已保存: ${templateName} (ID: ${templateId})`);
    return templateId;
  }

  // 获取Props模板
  getPropsTemplate(templateId) {
    return this.propsTemplates.get(templateId);
  }

  // 根据名称获取Props模板
  getPropsTemplateByName(templateName) {
    return Array.from(this.propsTemplates.values()).find(template => template.name === templateName);
  }

  // 获取所有Props模板
  getAllPropsTemplates() {
    return Array.from(this.propsTemplates.values());
  }

  // 更新Props模板
  updatePropsTemplate(templateId, updates) {
    const template = this.propsTemplates.get(templateId);
    if (!template) {
      return null;
    }

    const updatedTemplate = {
      ...template,
      ...updates,
      updatedAt: new Date()
    };

    this.propsTemplates.set(templateId, updatedTemplate);
    
    // 自动保存模板到本地
    this.saveTemplates();
    
    console.log(`📝 Props模板已更新: ${template.name} (ID: ${templateId})`);
    return updatedTemplate;
  }

  // 删除Props模板
  deletePropsTemplate(templateId) {
    const template = this.propsTemplates.get(templateId);
    if (!template) {
      return false;
    }

    this.propsTemplates.delete(templateId);
    
    // 自动保存模板到本地
    this.saveTemplates();
    
    console.log(`🗑️ Props模板已删除: ${template.name} (ID: ${templateId})`);
    return true;
  }

  // 使用Props模板创建任务
  addTaskWithTemplate(templateId, overrideConfig = {}) {
    const template = this.getPropsTemplate(templateId);
    if (!template) {
      throw new Error(`Props模板不存在: ${templateId}`);
    }

    const taskConfig = {
      outputLocation: "./out",
      fileName: `${template.name}-${Date.now()}.mp4`,
      customProps: template.props,
      composition: "CombinedShowcase",  // 修改默认组合名称
      ...overrideConfig // 允许覆盖配置
    };

    return this.addTask(taskConfig);
  }

  // 处理下一个任务
  async processNextTask() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      console.log("✅ 队列为空，等待新任务...");
      return;
    }

    this.isProcessing = true;
    const taskId = this.queue.shift();
    const task = this.tasks.get(taskId);

    if (!task) {
      console.error(`❌ 任务 ${taskId} 不存在`);
      this.processNextTask();
      return;
    }

    console.log(`🎬 开始处理任务: ${taskId}`);
    
    // 更新任务状态并保存
    this.updateTaskStatus(taskId, {
      status: 'processing',
      startedAt: new Date()
    });

    try {
      // 执行视频渲染
      const result = await this.renderVideo(task);
      
      // 任务完成并保存
      this.updateTaskStatus(taskId, {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        outputPath: result.outputPath,
        outputFileName: result.fileName
      });
      
      console.log(`✅ 任务完成: ${taskId}`);
      console.log(`📁 输出文件: ${result.fileName}`);
      
    } catch (error) {
      // 任务失败并保存
      this.updateTaskStatus(taskId, {
        status: 'failed',
        error: error.message,
        completedAt: new Date()
      });
      
      console.error(`❌ 任务失败: ${taskId}`);
      console.error(`❌ 错误类型: ${error.name}`);
      console.error(`❌ 错误信息: ${error.message}`);
      console.error(`❌ 任务配置:`, JSON.stringify(task.config, null, 2));
      
      // 如果是超时错误，提供解决建议
      if (error.message.includes('Timeout')) {
        console.error(`💡 解决建议:`);
        console.error(`   1. 检查视频长度是否过长（当前超时设置: 5分钟）`);
        console.error(`   2. 优化组件性能，减少复杂动画`);
        console.error(`   3. 降低视频分辨率或帧率`);
        console.error(`   4. 增加 timeoutInMilliseconds 值`);
      }
      
      if (error.stack) {
        console.error(`❌ 错误堆栈:`, error.stack);
      }
    }

    // 处理下一个任务
    setTimeout(() => this.processNextTask(), 1000);
  }

  // 渲染视频
  async renderVideo(task) {
    const { config } = task;
    const {
      outputLocation = "./out",
      fileName,
      customProps = {},
      composition = "CombinedShowcase"  // 修改默认组合为存在的组合
    } = config;

    console.log(`💻 开始CPU渲染任务: ${task.id}`);
    console.log(`🎭 目标组合: ${composition}`);
    console.log(`📋 task:`, task);
    
    // 确保输出目录存在
    const outputDir = path.resolve(outputLocation);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 生成文件名
    const timestamp = Date.now();
    const outputFileName = fileName || `video-${timestamp}.mp4`;
    const outputPath = path.resolve(outputDir, outputFileName);

    // 1. 打包项目
    console.log(`📦 正在打包项目...`);
    const bundleLocation = await bundle({
      entryPoint: path.resolve("./src/index.ts"),
      onProgress: (progress) => {
        const bundleProgress = Math.round(progress * 20); // 打包占总进度的20%
        this.updateTaskStatus(task.id, { progress: bundleProgress });
        console.log(`📦 打包进度: ${bundleProgress}%`);
      },
    });

    // 2. 获取组合 - 只使用API传入的props
    console.log(`🎭 获取组合信息...`);
    console.log(`📋 传递给getCompositions的props:`, customProps);
    const compositions = await getCompositions(bundleLocation, {
      inputProps: customProps
    });

    const comp = compositions.find((c) => c.id === composition);
    if (!comp) {
      console.error(`❌ 可用的组合:`, compositions.map(c => c.id));
      throw new Error(`未找到名为 '${composition}' 的组合。可用组合: ${compositions.map(c => c.id).join(', ')}`);
    }

    console.log(`✅ 找到组合: ${comp.id}`);
    console.log(`📏 视频尺寸: ${comp.width}x${comp.height}`);
    console.log(`🎬 帧率: ${comp.fps}`);
    console.log(`📋 组合默认Props (将被忽略):`, comp.defaultProps);
    console.log(`📋 最终使用的Props (仅API传入):`, task);

    // 3. 渲染视频 - 只使用API传入的props，不与默认props合并
    console.log(`🎬 开始渲染，总帧数: ${comp.durationInFrames}，预计时长: ${Math.round(comp.durationInFrames / comp.fps)}秒`);
    
    await renderMedia({
      composition: comp,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: customProps,  // 只使用API传入的props，不进行任何合并
      
      // CPU优化渲染配置
      concurrency: 1, // CPU服务器使用单线程渲染，避免资源竞争
      jpegQuality: 90,
      scale: 1,
      pixelFormat: "yuv420p",
      
      // 超时配置
      timeoutInMilliseconds: 300000 * 3,
      
      // CPU优化的Chromium配置 - 解决开始几帧问题
      chromiumOptions: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-extensions",
          "--disable-plugins",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--disable-features=TranslateUI",
          "--disable-ipc-flooding-protection",
          "--max_old_space_size=4096",
          "--disable-software-rasterizer",
          "--disable-gpu", // 明确禁用GPU
          "--disable-gpu-compositing",
          "--disable-gpu-rasterization",
          "--disable-gpu-sandbox",
          "--disable-web-security",
          "--allow-running-insecure-content",
          // 解决开始几帧问题的关键配置
          "--disable-features=VizDisplayCompositor",
          "--disable-features=AudioServiceOutOfProcess",
          "--autoplay-policy=no-user-gesture-required",
          "--disable-background-media-suspend",
          "--disable-media-suspend",
          "--force-prefers-reduced-motion",
          "--disable-smooth-scrolling",
          "--disable-threaded-animation",
          "--disable-checker-imaging",
          "--disable-new-content-rendering-timeout"
        ],
        headless: true,
        // 增加页面加载等待时间，确保完全初始化
        slowMo: 100
      },
      
      // 音视频同步配置 - 解决开始几帧音频卡顿问题
      enforceAudioTrack: false, // 禁用强制音频轨道，避免音频初始化延迟
      muted: false,
      
      // 帧渲染配置
      everyNthFrame: 1,
      numberOfGifLoops: null,
      
      // 关键：添加延迟启动，让浏览器和媒体完全初始化
      delayRenderTimeoutInMilliseconds: 30000, // 30秒延迟渲染超时
      
      // 禁用一些可能导致初始帧问题的功能
      disallowParallelEncoding: true, // 禁用并行编码，确保顺序渲染
      
      // 添加预热帧，跳过可能不稳定的开始几帧
      frameRange: [3, comp.durationInFrames - 1], // 从第4帧开始渲染，跳过前3帧，结束帧需要减1
      
      // 进度回调
      onProgress: ({ progress, renderedFrames, encodedFrames }) => {
        const renderProgress = 20 + Math.round(progress * 80); // 渲染占80%
        this.updateTaskStatus(task.id, { progress: renderProgress });
        console.log(`💻 任务 ${task.id} CPU渲染进度: ${renderProgress}% (帧 ${renderedFrames}/${comp.durationInFrames})`);
        
        // 输出更详细的进度信息
        if (renderedFrames % 100 === 0 || progress === 1) {
          console.log(`🎯 详细进度 - 已渲染: ${renderedFrames}, 已编码: ${encodedFrames}, 总帧数: ${comp.durationInFrames}`);
        }
      },
    });

    return {
      outputPath,
      fileName: outputFileName
    };
  }

  // 检查文件是否存在
  checkFileExists(taskId) {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'completed' || !task.outputPath) {
      return false;
    }
    
    return fs.existsSync(task.outputPath);
  }

  // 获取文件信息
  getFileInfo(taskId) {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'completed' || !task.outputPath) {
      return null;
    }

    try {
      const stats = fs.statSync(task.outputPath);
      return {
        path: task.outputPath,
        fileName: task.outputFileName,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime
      };
    } catch (error) {
      console.error(`获取文件信息失败: ${error.message}`);
      return null;
    }
  }

  // 清理旧任务记录
  cleanupOldTasks(daysOld = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let cleanedCount = 0;
    for (const [taskId, task] of this.tasks) {
      if (task.completedAt && new Date(task.completedAt) < cutoffDate) {
        // 删除对应的视频文件
        if (task.outputPath && fs.existsSync(task.outputPath)) {
          try {
            fs.unlinkSync(task.outputPath);
            console.log(`🗑️ 已删除旧视频文件: ${task.outputFileName}`);
          } catch (error) {
            console.error(`❌ 删除文件失败: ${error.message}`);
          }
        }
        
        this.tasks.delete(taskId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.saveTasks();
      console.log(`🧹 已清理 ${cleanedCount} 个超过 ${daysOld} 天的旧任务`);
    }
    
    return cleanedCount;
  }

  // 获取存储统计信息
  getStorageStats() {
    const completedTasks = Array.from(this.tasks.values()).filter(t => t.status === 'completed');
    const totalFiles = completedTasks.length;
    let totalSize = 0;
    let existingFiles = 0;

    completedTasks.forEach(task => {
      if (task.outputPath && fs.existsSync(task.outputPath)) {
        try {
          const stats = fs.statSync(task.outputPath);
          totalSize += stats.size;
          existingFiles++;
        } catch (error) {
          console.error(`获取文件大小失败: ${task.outputPath}`);
        }
      }
    });

    return {
      totalTasks: this.tasks.size,
      completedTasks: completedTasks.length,
      pendingTasks: Array.from(this.tasks.values()).filter(t => t.status === 'pending').length,
      processingTasks: Array.from(this.tasks.values()).filter(t => t.status === 'processing').length,
      failedTasks: Array.from(this.tasks.values()).filter(t => t.status === 'failed').length,
      totalFiles,
      existingFiles,
      missingFiles: totalFiles - existingFiles,
      totalSize,
      totalSizeFormatted: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
      queueLength: this.queue.length,
      isProcessing: this.isProcessing
    };
  }
}

// 创建任务队列实例
const taskQueue = new TaskQueue();

// API路由

// 提交任务
app.post('/api/tasks', (req, res) => {
  try {
    const {
      outputLocation,
      fileName,
      customProps,
      props,  // 新增props参数
      composition
    } = req.body;

    // 验证必要参数 - 支持props或customProps或fileName
    if (!props && !customProps && !fileName) {
      return res.status(400).json({
        success: false,
        error: '请提供 props、customProps 或 fileName 参数'
      });
    }

    // 优先使用props，然后是customProps
    const finalProps = props;

    const taskConfig = {
      outputLocation: outputLocation || "./out",
      fileName,
      customProps: finalProps,
      composition: composition || "CombinedShowcase"  // 修改默认组合名称
    };

    const taskId = taskQueue.addTask(taskConfig);

    res.json({
      success: true,
      taskId,
      message: '任务已提交到队列',
      queueLength: taskQueue.queue.length,
      receivedProps: finalProps  // 返回接收到的props确认
    });

    console.log(`📨 API: 新任务提交 ${taskId}`);
    console.log(`📋 接收到的props:`, finalProps);

  } catch (error) {
    console.error('提交任务错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 查询任务状态
app.get('/api/tasks/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const task = taskQueue.getTask(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    // 计算队列位置
    const queuePosition = task.status === 'pending' 
      ? taskQueue.queue.indexOf(taskId) + 1 
      : 0;

    const response = {
      success: true,
      task: {
        id: task.id,
        status: task.status,
        progress: task.progress,
        queuePosition,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        outputFileName: task.outputFileName,
        error: task.error,
        // 如果任务完成，提供下载链接
        downloadUrl: task.status === 'completed' && task.outputFileName 
          ? `/api/download/${taskId}` 
          : null
      }
    };

    res.json(response);

  } catch (error) {
    console.error('查询任务错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取所有任务状态
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = taskQueue.getAllTasks().map(task => ({
      id: task.id,
      status: task.status,
      progress: task.progress,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      outputFileName: task.outputFileName,
      error: task.error,
      // 如果任务完成，提供下载链接
      downloadUrl: task.status === 'completed' && task.outputFileName 
        ? `/api/download/${task.id}` 
        : null
    }));

    res.json({
      success: true,
      tasks,
      queueLength: taskQueue.queue.length,
      isProcessing: taskQueue.isProcessing
    });

  } catch (error) {
    console.error('获取任务列表错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 视频下载接口
app.get('/api/download/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const task = taskQueue.getTask(taskId);

    // 验证任务是否存在
    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    // 验证任务是否已完成
    if (task.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `任务尚未完成，当前状态: ${task.status}`,
        taskStatus: task.status,
        progress: task.progress
      });
    }

    // 验证文件路径是否存在
    if (!task.outputPath) {
      return res.status(500).json({
        success: false,
        error: '文件路径不存在'
      });
    }

    // 验证文件是否存在
    if (!fs.existsSync(task.outputPath)) {
      console.error(`❌ 文件不存在: ${task.outputPath}`);
      return res.status(404).json({
        success: false,
        error: '视频文件不存在，可能已被删除'
      });
    }

    // 获取文件信息
    const fileInfo = taskQueue.getFileInfo(taskId);
    if (!fileInfo) {
      return res.status(500).json({
        success: false,
        error: '无法获取文件信息'
      });
    }

    console.log(`📥 开始下载: ${taskId} - ${fileInfo.fileName}`);
    console.log(`📁 文件路径: ${task.outputPath}`);
    console.log(`📊 文件大小: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`);

    // 设置响应头
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', fileInfo.size);
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    // 支持断点续传
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileInfo.size - 1;
      const chunksize = (end - start) + 1;
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileInfo.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      
      const stream = fs.createReadStream(task.outputPath, { start, end });
      stream.pipe(res);
      
      console.log(`📥 断点续传下载: ${start}-${end}/${fileInfo.size}`);
    } else {
      // 创建文件流并发送
      const stream = fs.createReadStream(task.outputPath);
      
      // 处理流错误
      stream.on('error', (error) => {
        console.error(`❌ 文件流错误: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: '文件读取错误'
          });
        }
      });

      // 处理下载完成
      stream.on('end', () => {
        console.log(`✅ 下载完成: ${taskId} - ${fileInfo.fileName}`);
      });

      // 发送文件
      stream.pipe(res);
    }

  } catch (error) {
    console.error('下载文件错误:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

// 获取文件信息接口（不下载，只获取文件元信息）
app.get('/api/files/:taskId/info', (req, res) => {
  try {
    const { taskId } = req.params;
    const task = taskQueue.getTask(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    if (task.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `任务尚未完成，当前状态: ${task.status}`,
        taskStatus: task.status,
        progress: task.progress
      });
    }

    const fileInfo = taskQueue.getFileInfo(taskId);
    if (!fileInfo) {
      return res.status(404).json({
        success: false,
        error: '文件不存在或无法访问'
      });
    }

    res.json({
      success: true,
      fileInfo: {
        fileName: fileInfo.fileName,
        size: fileInfo.size,
        sizeFormatted: `${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`,
        createdAt: fileInfo.createdAt,
        modifiedAt: fileInfo.modifiedAt,
        downloadUrl: `/api/download/${taskId}`
      },
      taskInfo: {
        id: task.id,
        completedAt: task.completedAt,
        renderDuration: task.completedAt && task.startedAt 
          ? Math.round((task.completedAt - task.startedAt) / 1000) + '秒'
          : null
      }
    });

  } catch (error) {
    console.error('获取文件信息错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取存储统计信息
app.get('/api/stats', (req, res) => {
  try {
    const stats = taskQueue.getStorageStats();
    res.json({
      success: true,
      stats,
      dataDirectory: taskQueue.dataDir,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('获取统计信息错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 清理旧任务
app.post('/api/cleanup', (req, res) => {
  try {
    const { daysOld = 7 } = req.body;
    const cleanedCount = taskQueue.cleanupOldTasks(daysOld);
    
    res.json({
      success: true,
      message: `已清理 ${cleanedCount} 个超过 ${daysOld} 天的旧任务`,
      cleanedCount,
      daysOld
    });
  } catch (error) {
    console.error('清理任务错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Props模板管理API

// 保存Props模板
app.post('/api/templates', (req, res) => {
  try {
    const { name, props, description } = req.body;
    
    if (!name || !props) {
      return res.status(400).json({
        success: false,
        error: '请提供模板名称和props参数'
      });
    }

    const templateId = taskQueue.savePropsTemplate(name, props, description);
    
    res.json({
      success: true,
      templateId,
      message: `Props模板 "${name}" 已保存`
    });

  } catch (error) {
    console.error('保存模板错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取所有Props模板
app.get('/api/templates', (req, res) => {
  try {
    const templates = taskQueue.getAllPropsTemplates();
    res.json({
      success: true,
      templates,
      count: templates.length
    });
  } catch (error) {
    console.error('获取模板列表错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取单个Props模板
app.get('/api/templates/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const template = taskQueue.getPropsTemplate(templateId);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: '模板不存在'
      });
    }

    res.json({
      success: true,
      template
    });
  } catch (error) {
    console.error('获取模板错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 使用模板创建任务
app.post('/api/templates/:templateId/tasks', (req, res) => {
  try {
    const { templateId } = req.params;
    const overrideConfig = req.body;
    
    const taskId = taskQueue.addTaskWithTemplate(templateId, overrideConfig);
    
    res.json({
      success: true,
      taskId,
      message: '基于模板的任务已提交到队列',
      queueLength: taskQueue.queue.length
    });

  } catch (error) {
    console.error('使用模板创建任务错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 更新Props模板
app.put('/api/templates/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const updates = req.body;
    
    const updatedTemplate = taskQueue.updatePropsTemplate(templateId, updates);
    
    if (!updatedTemplate) {
      return res.status(404).json({
        success: false,
        error: '模板不存在'
      });
    }

    res.json({
      success: true,
      template: updatedTemplate,
      message: '模板已更新'
    });

  } catch (error) {
    console.error('更新模板错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 删除Props模板
app.delete('/api/templates/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const deleted = taskQueue.deletePropsTemplate(templateId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: '模板不存在'
      });
    }

    res.json({
      success: true,
      message: '模板已删除'
    });

  } catch (error) {
    console.error('删除模板错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  const stats = taskQueue.getStorageStats();
  res.json({
    success: true,
    status: 'running',
    timestamp: new Date(),
    queueLength: taskQueue.queue.length,
    isProcessing: taskQueue.isProcessing,
    stats: {
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      pendingTasks: stats.pendingTasks,
      failedTasks: stats.failedTasks,
      totalSize: stats.totalSizeFormatted
    }
  });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 视频渲染API服务已启动`);
  console.log(`🌐 服务地址: http://0.0.0.0:${PORT}`);
  console.log(`🌐 本地访问: http://localhost:${PORT}`);
  console.log(`📁 数据目录: ${taskQueue.dataDir}`);
  console.log(`📚 完整API文档:`);
  console.log(`\n📋 任务管理:`);
  console.log(`   POST /api/tasks - 提交渲染任务`);
  console.log(`   GET /api/tasks/:taskId - 查询任务状态`);
  console.log(`   GET /api/tasks - 获取所有任务`);
  console.log(`\n📥 文件下载:`);
  console.log(`   GET /api/download/:taskId - 下载生成的视频`);
  console.log(`   GET /api/files/:taskId/info - 获取文件信息`);
  console.log(`\n📊 系统管理:`);
  console.log(`   GET /api/stats - 获取存储统计信息`);
  console.log(`   POST /api/cleanup - 清理旧任务`);
  console.log(`   GET /api/health - 健康检查`);
  console.log(`\n📝 模板管理:`);
  console.log(`   POST /api/templates - 保存Props模板`);
  console.log(`   GET /api/templates - 获取所有模板`);
  console.log(`   GET /api/templates/:id - 获取单个模板`);
  console.log(`   PUT /api/templates/:id - 更新模板`);
  console.log(`   DELETE /api/templates/:id - 删除模板`);
  console.log(`   POST /api/templates/:id/tasks - 使用模板创建任务`);
  
  // 显示启动时的统计信息
  const stats = taskQueue.getStorageStats();
  console.log(`\n📊 启动统计:`);
  console.log(`   总任务数: ${stats.totalTasks}`);
  console.log(`   已完成: ${stats.completedTasks}`);
  console.log(`   等待中: ${stats.pendingTasks}`);
  console.log(`   处理中: ${stats.processingTasks}`);
  console.log(`   失败: ${stats.failedTasks}`);
  console.log(`   存储占用: ${stats.totalSizeFormatted}`);
  console.log(`\n🎯 ${stats.queueLength > 0 ? `队列中有 ${stats.queueLength} 个任务等待处理` : '等待任务提交...'}`);
});

export { app, taskQueue };

