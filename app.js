const state = {
  stream: null,
  recorder: null,
  chunks: [],
  recordingStartedAt: null,
  timerId: null,
  videoUrl: null,
  steps: [],
};

const els = {
  previewVideo: document.querySelector("#previewVideo"),
  emptyPreview: document.querySelector("#emptyPreview"),
  previewFrame: document.querySelector(".preview-frame"),
  startRecording: document.querySelector("#startRecording"),
  stopRecording: document.querySelector("#stopRecording"),
  videoUpload: document.querySelector("#videoUpload"),
  clearProject: document.querySelector("#clearProject"),
  addStep: document.querySelector("#addStep"),
  generateSop: document.querySelector("#generateSop"),
  stepNote: document.querySelector("#stepNote"),
  stepsList: document.querySelector("#stepsList"),
  stepCount: document.querySelector("#stepCount"),
  timer: document.querySelector("#timer"),
  recordingStatus: document.querySelector("#recordingStatus"),
  sopOutput: document.querySelector("#sopOutput"),
  sopTitleInput: document.querySelector("#sopTitleInput"),
  sopAudienceInput: document.querySelector("#sopAudienceInput"),
  sopVersionInput: document.querySelector("#sopVersionInput"),
  copyMarkdown: document.querySelector("#copyMarkdown"),
  downloadHtml: document.querySelector("#downloadHtml"),
  downloadJson: document.querySelector("#downloadJson"),
  stepTemplate: document.querySelector("#stepTemplate"),
};

const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = String(Math.floor(total / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${mins}:${secs}`;
};

const getElapsedSeconds = () => {
  if (!state.recordingStartedAt) {
    return els.previewVideo.currentTime || 0;
  }

  return (Date.now() - state.recordingStartedAt) / 1000;
};

const setStatus = (text, recording = false) => {
  els.recordingStatus.textContent = text;
  els.recordingStatus.classList.toggle("recording", recording);
};

const setVideoSource = (url, live = false) => {
  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = null;
  }

  if (typeof url === "string") {
    state.videoUrl = url;
    els.previewVideo.srcObject = null;
    els.previewVideo.src = url;
  }

  els.previewVideo.muted = live;
  els.previewVideo.controls = !live;
  els.previewFrame.classList.add("has-video");
  els.emptyPreview.hidden = true;
};

const startTimer = () => {
  stopTimer();
  state.timerId = window.setInterval(() => {
    els.timer.textContent = formatTime(getElapsedSeconds());
  }, 250);
};

const stopTimer = () => {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
};

const startRecording = async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert("当前浏览器不支持屏幕录制。请使用 Chrome、Edge 或 Safari 新版本。");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 12 },
      audio: false,
    });

    state.stream = stream;
    state.chunks = [];
    state.recordingStartedAt = Date.now();
    els.previewVideo.src = "";
    els.previewVideo.srcObject = stream;
    els.previewVideo.controls = false;
    els.previewVideo.muted = true;
    els.previewFrame.classList.add("has-video");
    els.emptyPreview.hidden = true;
    await els.previewVideo.play();

    const recorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
    state.recorder = recorder;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        state.chunks.push(event.data);
      }
    });

    recorder.addEventListener("stop", handleRecordingStop);
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      if (state.recorder?.state === "recording") {
        state.recorder.stop();
      }
    });

    recorder.start();
    els.startRecording.disabled = true;
    els.stopRecording.disabled = false;
    setStatus("录制中", true);
    startTimer();
  } catch (error) {
    console.error(error);
    setStatus("录制取消");
  }
};

const getSupportedMimeType = () => {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
};

const stopRecording = () => {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
  }
};

const handleRecordingStop = () => {
  stopTimer();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.recordingStartedAt = null;
  els.startRecording.disabled = false;
  els.stopRecording.disabled = true;
  setStatus("已生成录屏");

  const blob = new Blob(state.chunks, {
    type: state.chunks[0]?.type || "video/webm",
  });
  const url = URL.createObjectURL(blob);
  setVideoSource(url, false);
  els.previewVideo.play().catch(() => {});
};

const handleUpload = (event) => {
  const [file] = event.target.files;
  if (!file) return;

  const url = URL.createObjectURL(file);
  state.videoUrl = url;
  els.previewVideo.srcObject = null;
  els.previewVideo.src = url;
  els.previewVideo.controls = true;
  els.previewVideo.muted = false;
  els.previewFrame.classList.add("has-video");
  els.emptyPreview.hidden = true;
  setStatus("已上传视频");
};

const captureFrame = () => {
  const video = els.previewVideo;
  const canvas = document.createElement("canvas");
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (video.srcObject || video.readyState >= 2) {
    context.drawImage(video, 0, 0, width, height);
  } else {
    context.fillStyle = "#eef3f1";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#166b5b";
    context.font = "42px sans-serif";
    context.fillText("Step snapshot", 80, 120);
  }

  return canvas.toDataURL("image/jpeg", 0.82);
};

const inferStepTitle = (description, index) => {
  const trimmed = description.trim();
  if (!trimmed) return `步骤 ${index + 1}`;

  const firstSentence = trimmed.split(/[。.!?\n]/)[0].trim();
  return firstSentence.slice(0, 28) || `步骤 ${index + 1}`;
};

const addStep = () => {
  const description = els.stepNote.value.trim();
  const index = state.steps.length;
  const step = {
    id: crypto.randomUUID(),
    title: inferStepTitle(description, index),
    description: description || "补充该步骤的具体操作说明。",
    check: "确认页面状态与截图一致，关键字段已保存。",
    time: formatTime(getElapsedSeconds()),
    image: captureFrame(),
  };

  state.steps.push(step);
  els.stepNote.value = "";
  renderSteps();
  renderSop();
};

const renderSteps = () => {
  els.stepCount.textContent = `${state.steps.length} 步`;
  els.stepsList.innerHTML = "";

  if (state.steps.length === 0) {
    els.stepsList.innerHTML = `
      <div class="empty-state">
        <strong>还没有步骤</strong>
        <p>录制时点击“添加步骤截图”，系统会把截图、时间点和说明加入 SOP 草稿。</p>
      </div>
    `;
    return;
  }

  state.steps.forEach((step, index) => {
    const node = els.stepTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = step.id;
    node.querySelector(".step-image").src = step.image;
    node.querySelector(".step-image").alt = `${step.title} 的截图`;
    node.querySelector(".step-number").textContent = `步骤 ${index + 1}`;
    node.querySelector(".step-time").textContent = step.time;
    node.querySelector(".step-title-input").value = step.title;
    node.querySelector(".step-desc-input").value = step.description;
    node.querySelector(".step-check-input").value = step.check;
    node.querySelector(".move-up").disabled = index === 0;
    node.querySelector(".move-down").disabled = index === state.steps.length - 1;
    els.stepsList.appendChild(node);
  });
};

const updateStepFromInput = (target) => {
  const card = target.closest(".step-card");
  if (!card) return;

  const step = state.steps.find((item) => item.id === card.dataset.id);
  if (!step) return;

  if (target.classList.contains("step-title-input")) {
    step.title = target.value.trim() || "未命名步骤";
  }

  if (target.classList.contains("step-desc-input")) {
    step.description = target.value.trim() || "补充该步骤的具体操作说明。";
  }

  if (target.classList.contains("step-check-input")) {
    step.check = target.value.trim() || "确认该步骤已完成。";
  }

  renderSop();
};

const moveStep = (id, direction) => {
  const index = state.steps.findIndex((step) => step.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.steps.length) return;

  const [step] = state.steps.splice(index, 1);
  state.steps.splice(nextIndex, 0, step);
  renderSteps();
  renderSop();
};

const removeStep = (id) => {
  state.steps = state.steps.filter((step) => step.id !== id);
  renderSteps();
  renderSop();
};

const getSopMeta = () => ({
  title: els.sopTitleInput.value.trim() || "未命名 SOP",
  audience: els.sopAudienceInput.value.trim() || "未指定",
  version: els.sopVersionInput.value.trim() || "v0.1",
  updatedAt: new Date().toLocaleString("zh-CN"),
});

const renderSop = () => {
  if (state.steps.length === 0) {
    els.sopOutput.innerHTML = `
      <div class="empty-state">
        <strong>等待生成</strong>
        <p>添加至少一个步骤后点击“生成 SOP”。生成后仍可编辑步骤说明并重新生成。</p>
      </div>
    `;
    return;
  }

  const meta = getSopMeta();
  els.sopOutput.innerHTML = `
    <div class="sop-document">
      <header>
        <h4>${escapeHtml(meta.title)}</h4>
      </header>
      <div class="sop-summary">
        <div class="summary-box"><span>适用对象</span><strong>${escapeHtml(meta.audience)}</strong></div>
        <div class="summary-box"><span>版本</span><strong>${escapeHtml(meta.version)}</strong></div>
        <div class="summary-box"><span>步骤数量</span><strong>${state.steps.length} 步</strong></div>
      </div>
      <section>
        <h5>执行前检查</h5>
        <p>确认账号权限、业务系统、参考资料和客户信息已准备完毕。执行人应按步骤顺序操作，并在异常时暂停处理。</p>
      </section>
      ${state.steps
        .map(
          (step, index) => `
            <section class="sop-step">
              <img src="${step.image}" alt="${escapeHtml(step.title)} 的操作截图" />
              <div>
                <h5>${index + 1}. ${escapeHtml(step.title)}</h5>
                <p><strong>时间点：</strong>${escapeHtml(step.time)}</p>
                <p>${escapeHtml(step.description)}</p>
                <span class="checkline">检查标准：${escapeHtml(step.check)}</span>
              </div>
            </section>
          `,
        )
        .join("")}
      <section>
        <h5>异常处理</h5>
        <p>如果截图对应页面、字段、权限或结果与当前系统不一致，应停止执行并交由负责人确认后再继续。</p>
      </section>
      <section>
        <h5>维护规则</h5>
        <p>流程、系统界面或业务规则发生变化后，应重新录制关键步骤并更新该 SOP。</p>
      </section>
    </div>
  `;
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const buildMarkdown = () => {
  const meta = getSopMeta();
  const lines = [
    `# ${meta.title}`,
    "",
    `- 适用对象：${meta.audience}`,
    `- 版本：${meta.version}`,
    `- 更新时间：${meta.updatedAt}`,
    "",
    "## 执行前检查",
    "",
    "确认账号权限、业务系统、参考资料和客户信息已准备完毕。执行人应按步骤顺序操作，并在异常时暂停处理。",
    "",
    "## 操作步骤",
    "",
  ];

  state.steps.forEach((step, index) => {
    lines.push(`### ${index + 1}. ${step.title}`);
    lines.push("");
    lines.push(`- 时间点：${step.time}`);
    lines.push(`- 操作说明：${step.description}`);
    lines.push(`- 检查标准：${step.check}`);
    lines.push("");
  });

  lines.push("## 异常处理", "");
  lines.push("如果截图对应页面、字段、权限或结果与当前系统不一致，应停止执行并交由负责人确认后再继续。");
  lines.push("", "## 维护规则", "");
  lines.push("流程、系统界面或业务规则发生变化后，应重新录制关键步骤并更新该 SOP。");

  return lines.join("\n");
};

const copyMarkdown = async () => {
  if (state.steps.length === 0) return;
  await navigator.clipboard.writeText(buildMarkdown());
  els.copyMarkdown.textContent = "已复制";
  window.setTimeout(() => {
    els.copyMarkdown.textContent = "复制 Markdown";
  }, 1400);
};

const download = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadHtml = () => {
  if (state.steps.length === 0) return;
  const meta = getSopMeta();
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(meta.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.65; margin: 40px; color: #17211f; }
    img { max-width: 560px; width: 100%; border: 1px solid #d9e2df; border-radius: 8px; }
    section { margin: 28px 0; }
    .meta { color: #66736f; }
  </style>
</head>
<body>
  ${els.sopOutput.innerHTML}
</body>
</html>`;
  download(`${meta.title}.html`, html, "text/html;charset=utf-8");
};

const downloadJson = () => {
  if (state.steps.length === 0) return;
  const meta = getSopMeta();
  download(
    `${meta.title}.json`,
    JSON.stringify({ meta, steps: state.steps }, null, 2),
    "application/json;charset=utf-8",
  );
};

const clearProject = () => {
  stopTimer();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.recorder = null;
  state.chunks = [];
  state.steps = [];
  state.recordingStartedAt = null;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = null;
  els.previewVideo.pause();
  els.previewVideo.removeAttribute("src");
  els.previewVideo.srcObject = null;
  els.previewVideo.load();
  els.previewFrame.classList.remove("has-video");
  els.emptyPreview.hidden = false;
  els.timer.textContent = "00:00";
  els.startRecording.disabled = false;
  els.stopRecording.disabled = true;
  els.videoUpload.value = "";
  setStatus("未录制");
  renderSteps();
  renderSop();
};

els.startRecording.addEventListener("click", startRecording);
els.stopRecording.addEventListener("click", stopRecording);
els.videoUpload.addEventListener("change", handleUpload);
els.clearProject.addEventListener("click", clearProject);
els.addStep.addEventListener("click", addStep);
els.generateSop.addEventListener("click", renderSop);
els.copyMarkdown.addEventListener("click", copyMarkdown);
els.downloadHtml.addEventListener("click", downloadHtml);
els.downloadJson.addEventListener("click", downloadJson);

els.stepsList.addEventListener("input", (event) => {
  updateStepFromInput(event.target);
});

els.stepsList.addEventListener("click", (event) => {
  const card = event.target.closest(".step-card");
  if (!card) return;

  if (event.target.classList.contains("move-up")) {
    moveStep(card.dataset.id, -1);
  }

  if (event.target.classList.contains("move-down")) {
    moveStep(card.dataset.id, 1);
  }

  if (event.target.classList.contains("remove-step")) {
    removeStep(card.dataset.id);
  }
});

[els.sopTitleInput, els.sopAudienceInput, els.sopVersionInput].forEach((input) => {
  input.addEventListener("input", renderSop);
});

renderSteps();
renderSop();
