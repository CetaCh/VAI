/* ==========================================================================
 * VAI 安卓安装包入口（两个网页共用）
 *
 * 能力：
 *  - 页面底部固定「下载安卓安装包」入口（不遮挡内容：自动为 body 增加底部留白）
 *  - 点击后弹出面板：版本号 / 更新日志（支持 Markdown）/ 下载按钮
 *  - 安卓设备首次进入自动提示（带好处说明与更新日志，可关闭，本次会话只弹一次）
 *  - 版本信息来自 version.txt（与 App 内更新检查同一份文件）
 *
 * 用法：<script src="vai-apk.js" data-version="https://…/version.txt"></script>
 *      data-version 省略时按约定从同目录 version.txt 读取。
 * ========================================================================== */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    for (var i = s.length - 1; i >= 0; i--) if (/vai-apk\.js/.test(s[i].src)) return s[i];
    return null;
  })();
  var attrUrl = script ? script.getAttribute('data-version') : null;
  var attrOffset = script ? script.getAttribute('data-offset') : null;
  function defaultVersionUrl() {
    var base = script ? script.src.replace(/[^/]*$/, '') : '';
    return base + 'version.txt';
  }
  var VERSION_URLS = attrUrl
    ? [attrUrl]
    : (function () { var u = defaultVersionUrl(); return [u]; })();

  var APK_CANDIDATES = ['VidAI.apk'];

  var isAndroid = /Android/i.test(navigator.userAgent || '');
  var info = null;          // { version, versionId, markdown, log, link }
  var loading = false;
  var failed = '';
  var opened = false;

  /* ---------------- 解析 version.txt（与 App 内同一套规则） ---------------- */
  function unquote(v) {
    v = String(v == null ? '' : v).trim();
    if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
      v = v.slice(1, -1);
    }
    return v.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  function parseVersionFile(text) {
    var lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var keyRe = /^\s*([A-Za-z_][\w]*)\s*:\s*([\s\S]*)$/;
    var fields = {};
    var i = 0;
    while (i < lines.length) {
      var line = lines[i].trim();
      if (!line || line === '_head_' || line.charAt(0) === '#' || line.indexOf('//') === 0) { i++; continue; }
      if (line === '_end_') break;
      var m = keyRe.exec(line);
      if (!m) { i++; continue; }
      var key = m[1];
      var parts = [m[2]];
      var quoted = m[2].charAt(0) === '"';
      i++;
      while (i < lines.length) {
        var t = lines[i].trim();
        if (t === '_end_') break;
        var isKey = keyRe.test(t) && !(quoted && !closedText(parts.join('\n')));
        if (isKey) break;
        parts.push(lines[i]);
        i++;
      }
      fields[key] = parts.join('\n').trim();
    }
    var vid = parseInt(unquote(fields.version_id), 10);
    if (isNaN(vid)) return null;
    return {
      version: unquote(fields.version),
      versionId: vid,
      markdown: /^(true|1|yes)$/i.test(unquote(fields.update_log_markdown)),
      log: unquote(fields.update_log),
      link: unquote(fields.download_link)
    };
  }

  /** 多行字符串是否已出现收尾引号（引号后仅允许空白） */
  function closedText(v) {
    if (v.charAt(0) !== '"') return true;
    var body = v.slice(1);
    for (var k = 0; k < body.length; k++) {
      var c = body.charAt(k);
      if (c === '\\') { k++; continue; }
      if (c === '"') return body.slice(k + 1).trim() === '';
    }
    return false;
  }

  function loadInfo() {
    if (info || loading) return Promise.resolve(info);
    loading = true;
    var urls = VERSION_URLS.slice();
    // 相对路径失败时尝试同目录
    if (!attrUrl) urls.push('version.txt');

    function tryNext(idx) {
      if (idx >= urls.length) {
        loading = false;
        failed = '无法读取 version.txt';
        render();
        return null;
      }
      return fetch(urls[idx], { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (txt) {
          var parsed = parseVersionFile(txt);
          if (!parsed) throw new Error('格式不正确');
          info = parsed;
          loading = false;
          render();
          return info;
        })
        .catch(function () { return tryNext(idx + 1); });
    }
    return tryNext(0);
  }

  /* ---------------- Markdown（与 App 内一致的极简子集） ---------------- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mdToHtml(text, markdown) {
    if (!markdown) return esc(text).replace(/\n/g, '<br>');
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var t = raw.trim();
      if (!t) { if (inList) { out += '</ul>'; inList = false; } continue; }
      var h = /^(#{1,6})\s+(.*)$/.exec(t);
      if (h) {
        if (inList) { out += '</ul>'; inList = false; }
        out += '<div class="vai-md-h">' + esc(h[2]) + '</div>';
        continue;
      }
      var li = /^[-*+]\s+(.*)$/.exec(t);
      if (li) {
        if (!inList) { out += '<ul>'; inList = true; }
        out += '<li>' + esc(li[1]) + '</li>';
        continue;
      }
      if (inList) { out += '</ul>'; inList = false; }
      out += '<div>' + esc(t) + '</div>';
    }
    if (inList) out += '</ul>';
    return out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  /* ---------------- 渲染 ---------------- */
  var root, pill, panel, styleEl;

  function styles() {
    if (document.getElementById('vai-apk-style')) return;
    styleEl = document.createElement('style');
    styleEl.id = 'vai-apk-style';
    styleEl.textContent = [
      ':root{--vai-apk-offset:18px;--vai-apk-accent:#0071e3;--vai-apk-bg:rgba(16,16,24,.92);--vai-apk-fg:#fff;--vai-apk-dim:rgba(255,255,255,.72);--vai-apk-line:rgba(255,255,255,.14);}',
      '.vai-apk-pill{position:fixed;left:50%;transform:translateX(-50%);bottom:var(--vai-apk-offset);z-index:2147483000;',
      'display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;border:1px solid var(--vai-apk-line);',
      'background:var(--vai-apk-bg);color:var(--vai-apk-fg);font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
      'cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.35);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
      'transition:transform .18s ease,opacity .18s ease,box-shadow .18s ease;text-decoration:none;}',
      '.vai-apk-pill:hover{transform:translateX(-50%) translateY(-2px);box-shadow:0 12px 34px rgba(0,0,0,.45);}',
      '.vai-apk-pill svg{width:16px;height:16px;fill:currentColor;flex:none;}',
      '.vai-apk-pill .vai-apk-ver{font-weight:500;font-size:11px;color:var(--vai-apk-dim);}',
      '.vai-apk-spacer{height:calc(var(--vai-apk-offset) + 58px);pointer-events:none;}',
      '.vai-apk-mask{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.55);display:flex;align-items:center;',
      'justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .22s ease;}',
      '.vai-apk-mask.show{opacity:1;pointer-events:auto;}',
      '.vai-apk-sheet{width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;border-radius:20px;',
      'background:var(--vai-apk-bg);color:var(--vai-apk-fg);border:1px solid var(--vai-apk-line);',
      'box-shadow:0 24px 60px rgba(0,0,0,.5);transform:translateY(14px);transition:transform .22s ease;overflow:hidden;}',
      '.vai-apk-mask.show .vai-apk-sheet{transform:none;}',
      '.vai-apk-head{display:flex;align-items:flex-start;gap:12px;padding:18px 18px 10px;}',
      '.vai-apk-head h3{margin:0;font-size:17px;line-height:1.35;font-weight:700;}',
      '.vai-apk-head .vai-apk-sub{margin-top:4px;font-size:12px;color:var(--vai-apk-dim);line-height:1.5;}',
      '.vai-apk-x{margin-left:auto;flex:none;width:32px;height:32px;border-radius:50%;border:0;background:transparent;',
      'color:var(--vai-apk-dim);cursor:pointer;font-size:20px;line-height:1;display:grid;place-items:center;}',
      '.vai-apk-x:hover{background:rgba(255,255,255,.12);color:#fff;}',
      '.vai-apk-benefits{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 10px;}',
      '.vai-apk-benefits span{font-size:11px;padding:4px 10px;border-radius:999px;background:rgba(0,113,227,.18);',
      'border:1px solid rgba(0,113,227,.4);color:#9fd0ff;}',
      '.vai-apk-logwrap{padding:0 18px;overflow:auto;flex:1;min-height:0;}',
      '.vai-apk-log-title{font-size:12px;color:var(--vai-apk-dim);margin:4px 0 6px;}',
      '.vai-apk-log{font-size:13px;line-height:1.65;color:rgba(255,255,255,.92);}',
      '.vai-apk-log .vai-md-h{font-weight:700;font-size:14px;margin:8px 0 2px;}',
      '.vai-apk-log ul{margin:2px 0 6px 18px;padding:0;}.vai-apk-log li{margin:2px 0;}',
      '.vai-apk-foot{display:flex;gap:10px;padding:14px 18px 18px;}',
      '.vai-apk-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 16px;',
      'border-radius:12px;font:600 14px/1 inherit;text-decoration:none;border:1px solid transparent;cursor:pointer;}',
      '.vai-apk-btn.primary{background:var(--vai-apk-accent);color:#fff;}',
      '.vai-apk-btn.primary[aria-disabled="true"]{opacity:.5;pointer-events:none;}',
      '.vai-apk-btn.ghost{background:transparent;color:var(--vai-apk-fg);border-color:var(--vai-apk-line);}',
      '.vai-apk-note{padding:0 18px 12px;font-size:11px;color:var(--vai-apk-dim);line-height:1.5;}',
      '.vai-apk-err{color:#ff8a80;}',
      '@media (max-width:480px){.vai-apk-pill{font-size:12px;padding:9px 14px;}',
      '.vai-apk-sheet{max-height:90vh;}.vai-apk-head h3{font-size:16px;}}'
    ].join('\n');
    document.head.appendChild(styleEl);
  }

  function downloadIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4L10 13.2V3zM5 19h14v2H5z"/></svg>';
  }

  function apkUrl() {
    if (info && info.link && info.link.trim()) {
      var u = info.link.trim();
      return /^https?:\/\//i.test(u) ? u : 'https://' + u;
    }
    // 没有链接时退回同目录的约定文件名
    var base = location.href.replace(/[^/]*$/, '');
    return base + APK_CANDIDATES[0];
  }

  function build() {
    styles();
    // 页面若有底部固定栏（如底部 Tab），把入口抬到栏上方，绝不遮挡
    if (attrOffset) {
      document.documentElement.style.setProperty('--vai-apk-offset', attrOffset);
    }
    // 底部留白，保证悬浮按钮不遮挡页面内容
    var spacer = document.getElementById('vai-apk-spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.id = 'vai-apk-spacer';
      spacer.className = 'vai-apk-spacer';
      document.body.appendChild(spacer);
    }
    if (!pill) {
      pill = document.createElement('a');
      pill.className = 'vai-apk-pill';
      pill.id = 'vai-apk-pill';
      pill.href = 'javascript:void(0)';
      pill.setAttribute('role', 'button');
      pill.innerHTML = downloadIcon() + '<span>下载安卓安装包</span><span class="vai-apk-ver"></span>';
      pill.addEventListener('click', function (e) {
        e.preventDefault();
        open();
      });
      document.body.appendChild(pill);
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'vai-apk-mask';
      panel.id = 'vai-apk-mask';
      panel.innerHTML =
        '<div class="vai-apk-sheet" role="dialog" aria-modal="true" aria-labelledby="vai-apk-title">' +
        '  <div class="vai-apk-head">' +
        '    <div style="flex:1">' +
        '      <h3 id="vai-apk-title">下载安卓安装包</h3>' +
        '      <div class="vai-apk-sub" id="vai-apk-sub"></div>' +
        '    </div>' +
        '    <button class="vai-apk-x" id="vai-apk-close" aria-label="关闭">&times;</button>' +
        '  </div>' +
        '  <div class="vai-apk-benefits">' +
        '    <span>逐帧渲染更快</span><span>硬件编码导出 MP4</span><span>后台队列不中断</span><span>离线渲染</span>' +
        '  </div>' +
        '  <div class="vai-apk-logwrap">' +
        '    <div class="vai-apk-log-title">更新内容</div>' +
        '    <div class="vai-apk-log" id="vai-apk-log"></div>' +
        '  </div>' +
        '  <div class="vai-apk-note" id="vai-apk-note"></div>' +
        '  <div class="vai-apk-foot">' +
        '    <a class="vai-apk-btn primary" id="vai-apk-download" href="#" rel="noopener">' + downloadIcon() + '下载 APK</a>' +
        '    <button class="vai-apk-btn ghost" id="vai-apk-later">以后再说</button>' +
        '  </div>' +
        '</div>';
      document.body.appendChild(panel);
      panel.addEventListener('click', function (e) {
        if (e.target === panel) close();
      });
      panel.querySelector('#vai-apk-close').addEventListener('click', close);
      panel.querySelector('#vai-apk-later').addEventListener('click', close);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && opened) close();
      });
    }
  }

  function render() {
    if (!pill) return;
    var ver = pill.querySelector('.vai-apk-ver');
    if (ver) ver.textContent = info ? info.version : (loading ? '读取版本…' : '');
    if (!panel) return;
    var sub = panel.querySelector('#vai-apk-sub');
    var log = panel.querySelector('#vai-apk-log');
    var note = panel.querySelector('#vai-apk-note');
    var dl = panel.querySelector('#vai-apk-download');

    if (info) {
      sub.textContent = '版本 ' + info.version + '（' + info.versionId + '）';
      log.innerHTML = mdToHtml(info.log, info.markdown) || '<div>（暂无更新说明）</div>';
      var link = apkUrl();
      var placeholder = /请填写|example\.com|your/i.test(link);
      dl.setAttribute('href', link);
      dl.setAttribute('aria-disabled', placeholder ? 'true' : 'false');
      note.className = 'vai-apk-note';
      note.textContent = placeholder
        ? '下载地址尚未配置（version.txt 的 download_link）'
        : '安装包由 GitHub 发布，安装前请在系统设置中允许「安装未知应用」。';
    } else if (loading) {
      sub.textContent = '正在获取版本信息…';
      log.innerHTML = '<div>读取中…</div>';
      note.textContent = '';
    } else {
      sub.textContent = '版本信息获取失败';
      log.innerHTML = '<div class="vai-apk-err">' + esc(failed || '无法读取 version.txt') + '</div>' +
        '<div>仍可直接尝试下载同目录下的安装包。</div>';
      dl.setAttribute('href', apkUrl());
      dl.setAttribute('aria-disabled', 'false');
      note.className = 'vai-apk-note';
      note.textContent = '';
    }
  }

  function open() {
    build();
    opened = true;
    panel.classList.add('show');
    document.body.style.overflow = 'hidden';
    loadInfo();
    render();
  }

  function close() {
    opened = false;
    if (panel) panel.classList.remove('show');
    document.body.style.overflow = '';
    // 关闭过自动提示后本次会话不再弹
    try { sessionStorage.setItem('vai-apk-dismissed', '1'); } catch (e) {}
  }

  function maybeAutoPrompt() {
    if (!isAndroid) return;
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('vai-apk-dismissed') === '1'; } catch (e) {}
    if (dismissed) return;
    // 稍等页面渲染，避免和首屏动画抢资源
    setTimeout(function () {
      if (opened) return;
      open();
    }, 1200);
  }

  function init() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    build();
    loadInfo();
    maybeAutoPrompt();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 对外暴露，便于手动调用
  window.VaiApk = { open: open, close: close, reload: function () { info = null; failed = ''; return loadInfo(); } };
})();
