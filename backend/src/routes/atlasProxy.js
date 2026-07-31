/**
 * Atlas Cloud API 代理路由
 * 
 * 图片生成：POST /api/proxy/atlas/image → 返回 predictionId
 *            GET  /api/proxy/atlas/poll/:id → 轮询结果
 * 视频生成：POST /api/proxy/atlas/video → 返回 predictionId
 * 模型列表：GET  /api/proxy/atlas/models
 * 
 * 所有请求的 API Key 由后端注入，前端不可见。
 * 生成结果自动下载到 output/ 目录。
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const config = require('../config');

// 复用 proxy.js 的 loadRawSettings 逻辑
function loadRawSettings() {
  if (!fs.existsSync(config.SETTINGS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

const router = express.Router();

const ATLAS_BASE = process.env.ATLAS_BASE_URL || 'https://api.atlascloud.ai';
const ATLAS_API_KEY = process.env.ATLASCLOUD_API_KEY || '';

function getAtlasApiKey() {
  // 优先从环境变量读取（Railway 部署用）
  if (ATLAS_API_KEY) return ATLAS_API_KEY;
  // 其次从本地设置读取（本地开发用）
  const settings = loadRawSettings();
  return settings?.atlasApiKey || '';
}

function getPollUrl() {
  return `${ATLAS_BASE}/api/v1/model/prediction`;
}

/**
 * 下载远程文件到本地 output/ 目录，返回本地 URL
 */
async function downloadToOutput(remoteUrl, prefix = 'atlas') {
  const outputDir = config.OUTPUT_DIR;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ext = path.extname(new URL(remoteUrl).pathname).split('?')[0] || '.png';
  const filename = `${prefix}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const localPath = path.join(outputDir, filename);

  const resp = await fetch(remoteUrl);
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`);
  
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(localPath, buffer);
  
  return `/files/output/${filename}`;
}

// ========== 模型列表 ==========
router.get('/models', async (req, res) => {
  try {
    const resp = await fetch(`${ATLAS_BASE}/api/v1/models`);
    const data = await resp.json();
    
    // 过滤 display_console: true 的模型
    const models = (data.data || data || [])
      .filter(m => m.display_console !== false)
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        type: m.type,
        provider: m.provider,
        description: (m.description || '').slice(0, 100),
        pricing: m.pricing || m.price,
      }));
    
    // 按类型分组
    const grouped = {
      Image: models.filter(m => m.type === 'Image'),
      Video: models.filter(m => m.type === 'Video'),
      Audio: models.filter(m => m.type === 'Audio'),
      Text: models.filter(m => m.type === 'Text'),
    };
    
    res.json({ success: true, models: grouped, total: models.length });
  } catch (e) {
    res.status(500).json({ success: false, error: '获取模型列表失败: ' + e.message });
  }
});

// ========== 图片生成 ==========
router.post('/image', async (req, res) => {
  const apiKey = getAtlasApiKey();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '未配置 Atlas API Key' });
  }

  const { model, prompt, image_size, image_url, ...extraParams } = req.body;
  
  if (!model || !prompt) {
    return res.status(400).json({ success: false, error: '缺少 model 或 prompt 参数' });
  }

  try {
    const body = {
      model,
      prompt,
      ...(image_size ? { image_size } : { image_size: '1024x1024' }),
      ...(image_url ? { image_url } : {}),
    };

    console.log('[atlas/image] submit', { model, promptLen: prompt.length });

    const resp = await fetch(`${ATLAS_BASE}/api/v1/model/generateImage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json();
    
    if (!resp.ok || json.code !== 200) {
      return res.status(resp.status).json({
        success: false,
        error: json.msg || json.error || `HTTP ${resp.status}`,
      });
    }

    const predictionId = json.data?.id;
    res.json({ success: true, predictionId });
  } catch (e) {
    res.status(500).json({ success: false, error: '图片生成请求失败: ' + e.message });
  }
});

// ========== 视频生成 ==========
router.post('/video', async (req, res) => {
  const apiKey = getAtlasApiKey();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '未配置 Atlas API Key' });
  }

  const { model, prompt, duration, aspect_ratio, image_url, ...extraParams } = req.body;
  
  if (!model || !prompt) {
    return res.status(400).json({ success: false, error: '缺少 model 或 prompt 参数' });
  }

  try {
    const body = {
      model,
      prompt,
      ...(duration ? { duration } : {}),
      ...(aspect_ratio ? { aspect_ratio } : { aspect_ratio: '16:9' }),
      ...(image_url ? { image_url } : {}),
    };

    console.log('[atlas/video] submit', { model, promptLen: prompt.length });

    const resp = await fetch(`${ATLAS_BASE}/api/v1/model/generateVideo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json();
    
    if (!resp.ok || json.code !== 200) {
      return res.status(resp.status).json({
        success: false,
        error: json.msg || json.error || `HTTP ${resp.status}`,
      });
    }

    const predictionId = json.data?.id;
    res.json({ success: true, predictionId });
  } catch (e) {
    res.status(500).json({ success: false, error: '视频生成请求失败: ' + e.message });
  }
});

// ========== 轮询结果 ==========
router.get('/poll/:predictionId', async (req, res) => {
  const apiKey = getAtlasApiKey();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '未配置 Atlas API Key' });
  }

  const { predictionId } = req.params;

  try {
    const resp = await fetch(`${getPollUrl()}/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    const json = await resp.json();
    
    if (!resp.ok) {
      return res.status(resp.status).json({
        success: false,
        error: json.msg || json.error || `HTTP ${resp.status}`,
      });
    }

    const data = json.data || json;
    const status = data.status;

    if (status === 'completed' || status === 'succeeded') {
      const outputs = data.outputs || [];
      
      if (outputs.length > 0) {
        try {
          // 下载第一张到本地
          const localUrl = await downloadToOutput(outputs[0]);
          return res.json({
            success: true,
            status: 'completed',
            src: localUrl,
            remoteSrc: outputs[0],
            outputs,  // 保留所有输出 URL
          });
        } catch (downloadErr) {
          // 下载失败但生成成功，返回远程 URL
          return res.json({
            success: true,
            status: 'completed',
            src: outputs[0],
            outputs,
          });
        }
      }
      
      return res.json({ success: true, status: 'completed', outputs });
    }

    if (status === 'failed') {
      return res.json({
        success: false,
        status: 'failed',
        error: data.error || '生成失败',
      });
    }

    // 仍在处理中
    res.json({ success: true, status: status || 'processing' });
  } catch (e) {
    res.status(500).json({ success: false, error: '轮询失败: ' + e.message });
  }
});

module.exports = router;
