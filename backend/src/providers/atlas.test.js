const test = require('node:test');
const assert = require('node:assert/strict');
const atlas = require('./atlas');

// Regression coverage mirrors the public Atlas LLM, image, and video node routes.
const provider = {
  id: 'atlas',
  protocol: 'atlas',
  baseUrl: 'https://api.atlascloud.ai/api/v1',
  apiKey: 'test-key',
  imageModels: ['bytedance/seedream-v5.0-pro/text-to-image', 'bytedance/seedream-v5.0-pro/edit'],
  videoModels: [
    'kwaivgi/kling-v3.0-std/text-to-video',
    'kwaivgi/kling-v3.0-std/image-to-video',
    'atlascloud/wan-2.7-spicy/image-to-video',
    'atlascloud/wan-2.7-spicy/reference-to-video',
    'alibaba/wan-2.7/reference-to-video',
    'alibaba/wan-2.7/video-edit',
  ],
  chatModels: ['test/chat-model'],
  defaults: {
    imageModel: 'bytedance/seedream-v5.0-pro/text-to-image',
    videoModel: 'kwaivgi/kling-v3.0-std/text-to-video',
    chatModel: 'test/chat-model',
    pollIntervalMs: 1000,
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'test-request' },
  });
}

function generationFetch(assertSubmit, outputUrl) {
  return async (url, init = {}) => {
    if (String(url).includes('/model/prediction/')) {
      return jsonResponse({ code: 200, data: { status: 'completed', outputs: [outputUrl] } });
    }
    const body = JSON.parse(init.body);
    assertSubmit(String(url), body);
    return jsonResponse({ code: 200, data: { id: 'prediction-test', status: 'processing' } });
  };
}

test('Seedream v5 Pro text-to-image uses the Pro schema', async () => {
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-pro/text-to-image',
    prompt: 'a white circle',
    size: '1024x1024',
  }, {
    fetchImpl: generationFetch((url, body) => {
      assert.match(url, /\/model\/generateImage$/);
      assert.equal(body.model, 'bytedance/seedream-v5.0-pro/text-to-image');
      assert.equal(body.size, '1024*1024');
      assert.equal(body.output_format, 'jpeg');
      assert.ok(!('image_size' in body));
    }, 'https://example.com/output.jpg'),
  });
  assert.equal(result.ok, true);
});

test('Seedream v5 Pro switches to edit for references', async () => {
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-pro/text-to-image',
    prompt: 'turn it blue',
    images: ['https://example.com/input.png'],
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'bytedance/seedream-v5.0-pro/edit');
      assert.deepEqual(body.images, ['https://example.com/input.png']);
    }, 'https://example.com/edited.png'),
  });
  assert.equal(result.ok, true);
});

test('Kling v3 image-to-video preserves the official model and maps start/end frames', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/image-to-video',
    prompt: 'one continuous camera move',
    images: ['https://example.com/start.png', 'https://example.com/end.png'],
    duration: 8,
    resolution: '1080P',
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'kwaivgi/kling-v3.0-std/image-to-video');
      assert.equal(body.image, 'https://example.com/start.png');
      assert.equal(body.end_image, 'https://example.com/end.png');
      assert.equal(body.duration, 8);
      assert.equal(body.resolution, '1080P');
    }, 'https://example.com/kling-i2v.mp4'),
  });
  assert.equal(result.ok, true);
});

test('required image schemas fail before submitting without a reference', async () => {
  const seedream = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-pro/edit',
    prompt: 'edit this image',
  }, { fetchImpl: async () => { throw new Error('must not submit'); } });
  assert.equal(seedream.ok, false);
  assert.equal(seedream.code, 'invalid_model_parameters');
  assert.match(seedream.error, /至少需要一张参考图/);

  const kling = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/image-to-video',
    prompt: 'animate this image',
  }, { fetchImpl: async () => { throw new Error('must not submit'); } });
  assert.equal(kling.ok, false);
  assert.equal(kling.code, 'invalid_model_parameters');
  assert.match(kling.error, /需要一张首帧图/);
});

test('Atlas accepts code zero and a top-level upload url', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let uploadSeen = false;
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-pro/text-to-image',
    prompt: 'edit the uploaded pixel',
    images: [tinyPng],
  }, {
    fetchImpl: async (url, init = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/model/uploadMedia')) {
        uploadSeen = true;
        assert.ok(init.body instanceof FormData);
        return jsonResponse({ code: 0, url: 'https://example.com/uploaded.png' });
      }
      if (requestUrl.includes('/model/prediction/')) {
        return jsonResponse({ code: 0, data: { status: 'completed', outputs: ['https://example.com/edited.png'] } });
      }
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'bytedance/seedream-v5.0-pro/edit');
      assert.deepEqual(body.images, ['https://example.com/uploaded.png']);
      return jsonResponse({ code: 0, data: { id: 'prediction-zero', status: 'processing' } });
    },
  });
  assert.equal(uploadSeen, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ['https://example.com/edited.png']);
});

test('Wan 2.7 Spicy maps first-frame image-to-video fields', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'atlascloud/wan-2.7-spicy/image-to-video',
    prompt: 'slow camera push',
    images: ['https://example.com/start.png'],
    duration: 12,
    resolution: '1080P',
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.image, 'https://example.com/start.png');
      assert.equal(body.duration, 12);
      assert.equal(body.resolution, '1080P');
      assert.match(body.negative_prompt, /camera cut/);
    }, 'https://example.com/spicy.mp4'),
  });
  assert.equal(result.ok, true);
});

test('Wan 2.7 reference-to-video maps image, video and audio references', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'alibaba/wan-2.7/reference-to-video',
    prompt: 'character1 walks forward',
    images: ['https://example.com/character.png'],
    videos: ['https://example.com/motion.mp4'],
    audios: ['https://example.com/voice.mp3'],
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.deepEqual(body.images, ['https://example.com/character.png']);
      assert.deepEqual(body.videos, ['https://example.com/motion.mp4']);
      assert.equal(body.audio, 'https://example.com/voice.mp3');
    }, 'https://example.com/reference.mp4'),
  });
  assert.equal(result.ok, true);
});

test('Wan 2.7 video-edit requires and maps the source video', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'alibaba/wan-2.7/video-edit',
    prompt: 'cinematic commercial lighting',
    videos: ['https://example.com/source.mp4'],
    images: ['https://example.com/style.png'],
    duration: 0,
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.video, 'https://example.com/source.mp4');
      assert.deepEqual(body.images, ['https://example.com/style.png']);
      assert.equal(body.duration, 0);
    }, 'https://example.com/edited.mp4'),
  });
  assert.equal(result.ok, true);
});

test('Atlas LLM uses the official OpenAI-compatible v1 chat endpoint', async () => {
  let requestedUrl = '';
  const result = await atlas.generateChat(provider, {
    model: 'test/chat-model',
    messages: [{ role: 'user', content: 'reply pong' }],
  }, {
    fetchImpl: async (url, init = {}) => {
      requestedUrl = String(url);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'test/chat-model');
      assert.equal(init.headers.Authorization, 'Bearer test-key');
      return jsonResponse({ choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }] });
    },
  });
  assert.equal(requestedUrl, 'https://api.atlascloud.ai/v1/chat/completions');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'pong');
});

test('Spicy reference-to-video binds every image with attached_subject syntax', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'atlascloud/wan-2.7-spicy/reference-to-video',
    prompt: 'The subjects walk forward together.',
    images: [
      'https://example.com/subject-1.png',
      'https://example.com/subject-2.png',
      'https://example.com/subject-3.png',
    ],
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'atlascloud/wan-2.7-spicy/reference-to-video');
      assert.equal(body.images.length, 3);
      for (let index = 1; index <= 3; index += 1) {
        assert.match(body.prompt, new RegExp(`attached_subject@image${index}`));
      }
      assert.equal(body.prompt_extend, false);
    }, 'https://example.com/spicy-reference.mp4'),
  });
  assert.equal(result.ok, true);
});

test('Alibaba Wan reference-to-video adds ordered character labels', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'alibaba/wan-2.7/reference-to-video',
    prompt: 'They interact naturally in one continuous shot.',
    images: ['https://example.com/character-a.png', 'https://example.com/character-b.png'],
    videos: ['https://example.com/character-c.mp4'],
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.deepEqual(body.images, [
        'https://example.com/character-a.png',
        'https://example.com/character-b.png',
      ]);
      assert.deepEqual(body.videos, ['https://example.com/character-c.mp4']);
      assert.match(body.prompt, /character1/i);
      assert.match(body.prompt, /character2/i);
      assert.match(body.prompt, /character3/i);
      assert.equal(body.prompt_extend, false);
    }, 'https://example.com/alibaba-reference.mp4'),
  });
  assert.equal(result.ok, true);
});
