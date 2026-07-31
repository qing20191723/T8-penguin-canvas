const test = require('node:test');
const assert = require('node:assert/strict');
const atlas = require('./atlas');

const provider = {
  id: 'atlas',
  protocol: 'atlas',
  baseUrl: 'https://api.atlascloud.ai/api/v1',
  apiKey: 'test-key',
  imageModels: ['bytedance/seedream-v5.0-lite', 'bytedance/seedream-v5.0-lite/edit'],
  videoModels: ['kwaivgi/kling-v3.0-std/text-to-video', 'kwaivgi/kling-v3.0-std/image-to-video'],
  defaults: {
    imageModel: 'bytedance/seedream-v5.0-lite',
    videoModel: 'kwaivgi/kling-v3.0-std/text-to-video',
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

test('Seedream v5 text-to-image uses the current model and schema', async () => {
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-lite',
    prompt: 'a white circle',
    size: '1024x1024',
    n: 1,
    providerParams: { image_size: '1024x1024', aspect_ratio: '1:1' },
  }, {
    fetchImpl: generationFetch((url, body) => {
      assert.match(url, /\/model\/generateImage$/);
      assert.equal(body.model, 'bytedance/seedream-v5.0-lite');
      assert.equal(body.size, '2048*2048');
      assert.equal(body.output_format, 'jpeg');
      assert.equal(body.enable_base64_output, false);
      assert.ok(!('image_size' in body));
      assert.ok(!('aspect_ratio' in body));
      assert.ok(!('n' in body));
    }, 'https://example.com/output.jpg'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ['https://example.com/output.jpg']);
});

test('Seedream v5 switches to edit when ImageNode supplies references', async () => {
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-lite',
    prompt: 'turn it blue',
    images: ['https://example.com/input.png'],
    size: '1536x1024',
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'bytedance/seedream-v5.0-lite/edit');
      assert.deepEqual(body.images, ['https://example.com/input.png']);
      assert.equal(body.size, '2496*1664');
      assert.ok(!('image' in body));
    }, 'https://example.com/edited.png'),
  });
  assert.equal(result.ok, true);
});

test('Kling v3 text-to-video uses the current Atlas model ID', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/text-to-video',
    prompt: 'a calm ocean',
    duration: 5,
    aspect_ratio: '16:9',
  }, {
    fetchImpl: generationFetch((url, body) => {
      assert.match(url, /\/model\/generateVideo$/);
      assert.equal(body.model, 'kwaivgi/kling-v3.0-std/text-to-video');
      assert.equal(body.duration, 5);
      assert.equal(body.aspect_ratio, '16:9');
      assert.equal(body.sound, true);
    }, 'https://example.com/output.mp4'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.videoUrls, ['https://example.com/output.mp4']);
});

test('Kling v3 switches to image-to-video for a reference image', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/text-to-video',
    prompt: 'slow camera push',
    images: ['https://example.com/start.png'],
    duration: 5,
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'kwaivgi/kling-v3.0-std/image-to-video');
      assert.equal(body.image, 'https://example.com/start.png');
    }, 'https://example.com/i2v.mp4'),
  });
  assert.equal(result.ok, true);
});
