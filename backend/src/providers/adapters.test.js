const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateAudioWithProvider,
  generateImageWithProvider,
  generateVideoWithProvider,
} = require('./adapters');

const provider = {
  id: 'atlas',
  protocol: 'atlas',
  baseUrl: 'https://api.atlascloud.ai/api/v1',
  apiKey: 'test-key',
  imageModels: ['google/nano-banana-pro/edit-developer'],
  videoModels: ['bytedance/seedance-2.0/image-to-video'],
  defaults: {
    imageModel: 'google/nano-banana-pro/edit-developer',
    videoModel: 'bytedance/seedance-2.0/image-to-video',
    pollIntervalMs: 1000,
  },
};

const audioProvider = {
  ...provider,
  audioModels: ['bytedance/seed-audio-1.0', 'bytedance/seed-asr-2.0'],
  defaults: { ...provider.defaults, audioModel: 'bytedance/seed-audio-1.0' },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'test-request' },
  });
}

function generationFetch(assertSubmit, outputUrl) {
  return async (url, init = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/model/prediction/')) {
      return jsonResponse({ code: 200, data: { status: 'completed', outputs: [outputUrl] } });
    }
    const body = JSON.parse(init.body);
    assertSubmit(requestUrl, body);
    return jsonResponse({ code: 200, data: { id: 'prediction-test', status: 'processing' } });
  };
}

test('Atlas image adapter derives 4k resolution and aspect ratio from canvas size', async () => {
  const result = await generateImageWithProvider(provider, {
    providerId: 'atlas',
    providerModel: 'google/nano-banana-pro/edit-developer',
    model: 'google/nano-banana-pro/edit-developer',
    prompt: 'edit the interior scene',
    size: '5376x3072',
    images: ['https://example.com/reference.jpg'],
  }, {
    modelType: 'Image',
    modelSchema: {
      type: 'object',
      required: ['prompt', 'images'],
      properties: {
        prompt: { type: 'string' },
        images: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        resolution: { type: 'string', enum: ['1k', '2k', '4k'] },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'] },
        output_format: { type: 'string', enum: ['jpeg', 'png'], default: 'jpeg' },
        enable_base64_output: { type: 'boolean', default: false },
      },
    },
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'google/nano-banana-pro/edit-developer');
      assert.equal(body.resolution, '4k');
      assert.equal(body.aspect_ratio, '16:9');
      assert.deepEqual(body.images, ['https://example.com/reference.jpg']);
      assert.ok(!('image_size' in body));
    }, 'https://example.com/nano-banana-4k.jpg'),
  });

  assert.equal(result.ok, true);
});

test('Atlas image adapter preserves explicit model-specific resolution override', async () => {
  const result = await generateImageWithProvider(provider, {
    providerId: 'atlas',
    providerModel: 'google/nano-banana-pro/edit-developer',
    model: 'google/nano-banana-pro/edit-developer',
    prompt: 'edit the interior scene',
    size: '5376x3072',
    resolution: '2k',
    aspect_ratio: '1:1',
    images: ['https://example.com/reference.jpg'],
  }, {
    modelType: 'Image',
    modelSchema: {
      type: 'object',
      required: ['prompt', 'images'],
      properties: {
        prompt: { type: 'string' },
        images: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        resolution: { type: 'string', enum: ['1k', '2k', '4k'] },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'] },
      },
    },
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.resolution, '2k');
      assert.equal(body.aspect_ratio, '1:1');
    }, 'https://example.com/nano-banana-2k.jpg'),
  });

  assert.equal(result.ok, true);
});

test('Atlas video adapter normalizes lowercase p-resolution for Seedance family', async () => {
  const result = await generateVideoWithProvider(provider, {
    providerId: 'atlas',
    providerModel: 'bytedance/seedance-2.0/image-to-video',
    model: 'bytedance/seedance-2.0/image-to-video',
    prompt: 'slow camera move',
    images: ['https://example.com/frame.jpg'],
    duration: 5,
    resolution: '720P',
    ratio: '16:9',
  }, {
    modelType: 'Video',
    modelSchema: {
      type: 'object',
      required: ['prompt', 'image'],
      properties: {
        prompt: { type: 'string' },
        image: { type: 'string' },
        duration: { type: 'integer', minimum: 1, maximum: 15 },
        resolution: { type: 'string', enum: ['480p', '720p', '1080p'] },
        ratio: { type: 'string', enum: ['adaptive', '16:9', '9:16', '1:1'] },
      },
    },
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'bytedance/seedance-2.0/image-to-video');
      assert.equal(body.resolution, '720p');
      assert.equal(body.ratio, '16:9');
      assert.equal(body.image, 'https://example.com/frame.jpg');
    }, 'https://example.com/seedance.mp4'),
  });

  assert.equal(result.ok, true);
});

test('Atlas audio adapter submits Seed Audio exactly once to generateAudio', async () => {
  let submitCount = 0;
  const result = await generateAudioWithProvider(audioProvider, {
    providerModel: 'bytedance/seed-audio-1.0',
    text: '你好，这是清尘 Atlas 画布。',
    providerParams: { format: 'mp3', sample_rate: 24000 },
  }, {
    modelType: 'Audio',
    modelSchema: {
      type: 'object',
      required: ['model', 'text'],
      properties: {
        model: { type: 'string' },
        text: { type: 'string' },
        format: { type: 'string', enum: ['mp3', 'wav'] },
        sample_rate: { type: 'integer', enum: [16000, 24000] },
      },
    },
    fetchImpl: async (url, init = {}) => {
      submitCount += 1;
      assert.match(String(url), /\/model\/generateAudio$/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'bytedance/seed-audio-1.0');
      assert.equal(body.text, '你好，这是清尘 Atlas 画布。');
      assert.equal(body.format, 'mp3');
      return jsonResponse({ code: 200, data: { status: 'completed', outputs: ['https://example.com/voice.mp3'] } });
    },
  });
  assert.equal(submitCount, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.audioUrls, ['https://example.com/voice.mp3']);
});

test('Atlas ASR returns text without requiring a media download or resubmission', async () => {
  let submitCount = 0;
  const result = await generateAudioWithProvider(audioProvider, {
    providerModel: 'bytedance/seed-asr-2.0',
    audio: 'https://example.com/speech.mp3',
  }, {
    modelType: 'Audio',
    modelSchema: {
      type: 'object',
      required: ['model', 'audio_url'],
      properties: { model: { type: 'string' }, audio_url: { type: 'string' } },
    },
    fetchImpl: async (url, init = {}) => {
      submitCount += 1;
      assert.match(String(url), /\/model\/generateAudio$/);
      assert.equal(JSON.parse(init.body).audio_url, 'https://example.com/speech.mp3');
      return jsonResponse({ code: 200, data: { status: 'completed', result: '测试转写成功。' } });
    },
  });
  assert.equal(submitCount, 1);
  assert.equal(result.ok, true);
  assert.equal(result.text, '测试转写成功。');
  assert.deepEqual(result.audioUrls, []);
});
