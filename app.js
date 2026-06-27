(() => {
  "use strict";

  const COLLECTION = "saaCue";
  const DOC_ID = "currentMessage";
  const IDLE_TEXT = "ーーー";
  let db = null;
  let docRef = null;
  let pendingMessageId = "";
  let pendingTimer = null;

  const isController = document.body.classList.contains("controller-page");
  const isDisplay = document.body.classList.contains("display-page");

  function setStatus(text, tone = "") {
    const controllerStatus = document.getElementById("statusText");
    const displayStatus = document.getElementById("displayStatus");
    if (controllerStatus) {
      controllerStatus.textContent = text;
      controllerStatus.className = "status-text" + (tone ? " " + tone : "");
    }
    if (displayStatus) displayStatus.textContent = text;
  }

  function setLast(text, tone = "") {
    const last = document.getElementById("lastSentText");
    if (!last) return;
    last.textContent = text;
    last.className = "last-sent" + (tone ? " " + tone : "");
  }

  function initFirebase() {
    if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
      setStatus("Firebase設定が読み込めません。firebase-config.jsを確認してください。", "error");
      return false;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
      db = firebase.firestore();
      docRef = db.collection(COLLECTION).doc(DOC_ID);
      setStatus("Firebase接続完了", "ok");
      return true;
    } catch (error) {
      console.error(error);
      setStatus("Firebase接続エラー: " + error.message, "error");
      return false;
    }
  }

  function classifyMessage(text, action, explicitType) {
    if (action === "clear") return "idle";
    if (explicitType) return explicitType;
    if (!text) return "idle";
    if (text === "あと５分" || text === "あと３分") return "navy";
    if (text === "あと１分" || text === "終わってください" || text === "STOP") return "red";
    if (text === "OK") return "ok";
    if (/^第.*回例会$/.test(text)) return "meeting";
    return "white";
  }

  function readableMessage(text, action) {
    if (action === "clear" || !String(text || "").trim()) return "ーーー";
    return String(text || "").trim();
  }

  function flashButton(button, className, duration = 850) {
    if (!button) return;
    button.classList.add(className);
    window.setTimeout(() => button.classList.remove(className), duration);
  }

  function markPendingTimeout(messageId, displayText) {
    if (pendingTimer) window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      if (pendingMessageId === messageId) {
        setStatus("iPad確認待ち（通信中）", "waiting");
        setLast("未確認：" + displayText + "　※iPad側の画面も確認してください", "waiting");
      }
    }, 2500);
  }

  async function sendMessage(text, action = "message", explicitType = "", sourceButton = null) {
    if (!docRef) {
      setStatus("Firebase未接続です。ページを再読み込みしてください。", "error");
      return;
    }
    const finalText = action === "clear" ? "" : String(text || "").trim();
    const type = classifyMessage(finalText, action, explicitType);
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const displayText = readableMessage(finalText, action);
    pendingMessageId = messageId;

    setStatus("送信中…", "waiting");
    setLast("送信中：" + displayText, "waiting");
    flashButton(sourceButton, "sending", 1100);
    if (navigator.vibrate) navigator.vibrate(45);

    try {
      await docRef.set({
        text: finalText,
        type,
        action,
        messageId,
        displayAckId: "",
        displayedText: "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        clientTime: new Date().toISOString()
      }, { merge: true });
      setStatus("送信済み・iPad表示待ち", "waiting");
      setLast("送信済み：" + displayText + "　→ iPad確認待ち", "waiting");
      flashButton(sourceButton, "sent", 1200);
      markPendingTimeout(messageId, displayText);
      if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
    } catch (error) {
      console.error(error);
      pendingMessageId = "";
      setStatus("送信エラー: " + error.message, "error");
      setLast("送信エラー：" + error.message, "error");
      flashButton(sourceButton, "send-error", 1800);
      if (navigator.vibrate) navigator.vibrate([90, 60, 90]);
    }
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, "");
  }

  function setupController() {
    document.querySelectorAll(".cue-button").forEach(button => {
      button.addEventListener("pointerdown", () => flashButton(button, "touching", 250), { passive: true });
      button.addEventListener("click", () => {
        const action = button.dataset.action || "message";
        const explicitType = button.dataset.type || "";
        if (action === "clear") sendMessage("", "clear", "idle", button);
        else sendMessage(button.dataset.message || button.textContent.trim(), action, explicitType, button);
      });
    });

    const meetingInput = document.getElementById("meetingNumber");
    const savedMeeting = localStorage.getItem("saaMeetingNumber");
    if (meetingInput && savedMeeting) meetingInput.value = savedMeeting;

    const meetingButton = document.getElementById("sendMeetingButton");
    if (meetingButton && meetingInput) {
      meetingButton.addEventListener("pointerdown", () => flashButton(meetingButton, "touching", 250), { passive: true });
      meetingButton.addEventListener("click", () => {
        const num = normalizeDigits(meetingInput.value);
        if (!num) { setStatus("例会番号を入力してください。", "error"); return; }
        localStorage.setItem("saaMeetingNumber", num);
        sendMessage(`第${num}回例会`, "message", "meeting", meetingButton);
      });
      meetingInput.addEventListener("keydown", e => { if (e.key === "Enter") meetingButton.click(); });
    }

    const freeInput = document.getElementById("freeMessage");
    const freeButton = document.getElementById("sendFreeButton");
    if (freeButton && freeInput) {
      freeButton.addEventListener("pointerdown", () => flashButton(freeButton, "touching", 250), { passive: true });
      freeButton.addEventListener("click", () => {
        const msg = freeInput.value.trim();
        if (!msg) { setStatus("自由入力欄に文字を入力してください。", "error"); return; }
        sendMessage(msg, "message", "free", freeButton);
      });
      freeInput.addEventListener("keydown", e => { if (e.key === "Enter") freeButton.click(); });
    }

    if (docRef) {
      docRef.onSnapshot(snapshot => {
        const data = snapshot.exists ? snapshot.data() : {};
        const action = data.action || "message";
        const currentText = readableMessage(data.text, action);
        const currentEl = document.getElementById("currentDisplayText");
        if (currentEl) currentEl.textContent = currentText;

        document.querySelectorAll(".cue-button.is-current").forEach(btn => btn.classList.remove("is-current"));
        document.querySelectorAll(".cue-button").forEach(btn => {
          const btnAction = btn.dataset.action || "message";
          const btnText = btnAction === "clear" ? "" : (btn.dataset.message || btn.textContent.trim());
          if ((action === "clear" && btnAction === "clear") || (action !== "clear" && btnText === data.text)) {
            btn.classList.add("is-current");
          }
        });

        if (data.messageId && data.displayAckId === data.messageId) {
          if (pendingMessageId === data.messageId) {
            pendingMessageId = "";
            if (pendingTimer) window.clearTimeout(pendingTimer);
            setLast("iPad表示確認済み：" + currentText, "ok");
            if (navigator.vibrate) navigator.vibrate([20, 35, 20, 35, 20]);
          }
          setStatus("iPad表示確認済み ✓", "ok");
        } else if (data.messageId && pendingMessageId === data.messageId) {
          setStatus("送信済み・iPad表示待ち", "waiting");
        }
      }, error => {
        console.error(error);
        setStatus("確認受信エラー: " + error.message, "error");
      });
    }
  }

  const LINE_BREAKS = new Map([
    ["まとめをお願いします", "まとめを\nお願いします"],
    ["マイクを近づけてください", "マイクを\n近づけてください"],
    ["もう少し大きな声でお願いします", "もう少し大きな声で\nお願いします"],
    ["ゆっくりお願いします", "ゆっくり\nお願いします"],
    ["次へお願いします", "次へ\nお願いします"],
    ["もう少し話してください", "もう少し\n話してください"],
    ["マイクをONにしてください", "マイクをONに\nしてください"],
    ["終わってください", "終わって\nください"]
  ]);

  function displayText(text) {
    const clean = String(text || "").trim() || IDLE_TEXT;
    if (LINE_BREAKS.has(clean)) return LINE_BREAKS.get(clean);
    return clean;
  }

  function countDisplayLines(element) {
    return (element.innerText || element.textContent || "").split("\n").length;
  }

  function fitText(element) {
    if (!element) return;
    const box = element.parentElement;
    if (!box) return;

    element.style.fontSize = "20px";
    element.style.lineHeight = "0.92";

    const maxW = Math.max(10, box.clientWidth * 0.99);
    const maxH = Math.max(10, box.clientHeight * 0.98);
    const lines = Math.min(2, Math.max(1, countDisplayLines(element)));

    let low = 20;
    let high = 2000;
    let best = low;

    for (let i = 0; i < 36; i++) {
      const mid = (low + high) / 2;
      element.style.fontSize = `${mid}px`;
      if (element.scrollWidth <= maxW && element.scrollHeight <= maxH) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    element.style.fontSize = `${Math.floor(best)}px`;
  }

  function renderMessage(data) {
    const messageEl = document.getElementById("displayMessage");
    const box = document.getElementById("messageBox");
    if (!messageEl || !box) return;

    const rawText = data && data.text ? String(data.text) : IDLE_TEXT;
    const type = data && data.type ? data.type : "idle";
    box.className = "message-box " + type;
    messageEl.textContent = displayText(rawText);
    requestAnimationFrame(() => fitText(messageEl));
  }

  function setupDisplay() {
    if (!docRef) return;
    docRef.onSnapshot(snapshot => {
      setStatus("Firebase接続完了");
      renderMessage(snapshot.exists ? snapshot.data() : { text: IDLE_TEXT, type: "idle" });
    }, error => {
      console.error(error);
      setStatus("受信エラー: " + error.message);
      renderMessage({ text: "受信エラー", type: "red" });
    });
    window.addEventListener("resize", () => fitText(document.getElementById("displayMessage")));
    window.addEventListener("orientationchange", () => setTimeout(() => fitText(document.getElementById("displayMessage")), 200));
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!initFirebase()) return;
    if (isController) setupController();
    if (isDisplay) setupDisplay();
  });
})();
