const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const configPath = process.argv[process.argv.length - 1];
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const { base, name, canvasId, imagePath, resultPath } = config;
const imageBase64 = fs.readFileSync(imagePath).toString('base64');
const result = {
  ok: false,
  canvasId,
  canvasName: name,
  consoleErrors: [],
};

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function execute(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

async function waitFor(win, source, label, timeoutMs = 90_000, intervalMs = 500) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await execute(win, source);
      if (last) return last;
    } catch (error) {
      last = error?.message || String(error);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function clickExactText(win, text) {
  const encoded = JSON.stringify(text);
  return execute(win, `(() => {
    const wanted = ${encoded};
    const all = [...document.querySelectorAll('button,[role="button"],a,div,span')]
      .filter((el) => (el.textContent || '').trim() === wanted && el.getClientRects().length > 0);
    const ranked = all.map((el) => {
      const target = el.closest('button,[role="button"],a') || el;
      const rect = target.getBoundingClientRect();
      return { target, area: Math.max(1, rect.width * rect.height) };
    }).sort((a, b) => a.area - b.area);
    const target = ranked[0]?.target;
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  })()`);
}

async function main() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) result.consoleErrors.push(String(message).slice(0, 500));
    console.log(`[browser:${level}] ${message}`);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[browser] load failed', code, description, url);
  });

  try {
    await win.loadURL(base, { userAgent: 'Qingchen-Live-Upload-Verification/1.0' });
    await waitFor(win, `document.body && document.body.innerText.includes('清尘无限画布')`, 'Qingchen canvas shell');
    await execute(win, `window.alert=(message)=>console.error('[alert]',message); window.confirm=()=>true; true`);

    await waitFor(win, `document.body.innerText.includes(${JSON.stringify(name)})`, 'test canvas in sidebar');
    const clickedCanvas = await clickExactText(win, name);
    if (!clickedCanvas) throw new Error('Could not click the isolated test canvas');
    await sleep(1500);

    const clickedUpload = await clickExactText(win, '上传素材');
    if (!clickedUpload) throw new Error('Could not click 上传素材 in the sidebar');
    const uploadNodeId = await waitFor(
      win,
      `document.querySelector('[data-upload-node-id]')?.getAttribute('data-upload-node-id') || ''`,
      'upload node creation',
    );
    result.uploadNodeId = uploadNodeId;

    await sleep(2500);
    const before = await execute(win, `(() => {
      const root=document.querySelector('[data-upload-node-id="${uploadNodeId}"]');
      if(!root) return null;
      const style=getComputedStyle(root);
      return { width:parseFloat(style.width)||0, height:parseFloat(style.height)||0, text:root.innerText };
    })()`);
    result.before = before;

    const bump = await execute(win, `(async()=>{
      const current=await fetch('/api/canvas/${canvasId}',{cache:'no-store'}).then(r=>r.json());
      const data=current.data;
      const response=await fetch('/api/canvas/${canvasId}',{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...data,baseRevision:data.revision}),
      });
      return {status:response.status,payload:await response.json(),previousRevision:data.revision};
    })()`);
    if (bump.status !== 200 || !bump.payload?.success) throw new Error(`Failed to create revision race: ${JSON.stringify(bump)}`);
    result.bumpedFromRevision = bump.previousRevision;
    result.bumpedToRevision = bump.payload?.data?.revision;

    const injected = await execute(win, `(() => {
      const root=document.querySelector('[data-upload-node-id="${uploadNodeId}"]');
      const input=root?.querySelector('input[type="file"]');
      if(!input) return false;
      const raw=atob(${JSON.stringify(imageBase64)});
      const bytes=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
      const file=new File([bytes],'portrait-540x960.png',{type:'image/png',lastModified:Date.now()});
      const dt=new DataTransfer();
      dt.items.add(file);
      input.files=dt.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`);
    if (!injected) throw new Error('Could not inject the portrait image into the upload input');

    await waitFor(
      win,
      `(() => {
        const root=document.querySelector('[data-upload-node-id="${uploadNodeId}"]');
        return !!root && /图像\\s*\\(1\\)/.test(root.innerText) && !!root.querySelector('img');
      })()`,
      'uploaded image preview',
      120_000,
    );

    const dimensions = await waitFor(
      win,
      `(() => {
        const root=document.querySelector('[data-upload-node-id="${uploadNodeId}"]');
        if(!root) return false;
        const style=getComputedStyle(root);
        const width=parseFloat(style.width)||0;
        const height=parseFloat(style.height)||0;
        return width>=300 && height>width ? {width,height,text:root.innerText} : false;
      })()`,
      'portrait-aware upload node size',
      60_000,
    );
    result.after = dimensions;
    if (/首尾|抠像|极速|质量/.test(dimensions.text || '')) {
      throw new Error(`Legacy media tool rail is still visible: ${dimensions.text}`);
    }

    const persisted = await waitFor(
      win,
      `(async()=>{
        const response=await fetch('/api/canvas/${canvasId}',{cache:'no-store'});
        if(!response.ok) return false;
        const payload=await response.json();
        const data=payload.data||{};
        const node=(data.nodes||[]).find((item)=>item.id===${JSON.stringify(uploadNodeId)});
        const serialized=JSON.stringify(node?.data||{});
        const hasImage=node && /portrait-540x960|imageUrl|imageItems|mediaItems|\\/files\\/(?:input|output)\\//.test(serialized);
        return hasImage && Number(data.revision)>${Number(bump.payload?.data?.revision || 0)}
          ? {revision:data.revision,nodeData:node.data}
          : false;
      })()`,
      'revision rebase and uploaded media persistence',
      120_000,
      1000,
    );
    result.persistedRevision = persisted.revision;
    result.persistedDataKeys = Object.keys(persisted.nodeData || {});

    const visibleConflict = await execute(win, `document.body.innerText.includes('画布 revision 冲突；本地修改已保留并阻止自动覆盖')`);
    if (visibleConflict) throw new Error('Persistent revision conflict warning is still visible after automatic rebase');

    result.ok = true;
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log('[browser] upload autosize and revision rebase verified', result);
  } catch (error) {
    result.error = error?.stack || error?.message || String(error);
    try {
      const screenshotPath = `${resultPath}.png`;
      await win.webContents.capturePage().then((image) => fs.writeFileSync(screenshotPath, image.toPNG()));
      result.screenshotPath = screenshotPath;
    } catch {}
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    throw error;
  } finally {
    win.destroy();
  }
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error('[browser] fatal', error);
    app.exit(1);
  });
