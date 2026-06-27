(() => {
  "use strict";

  const COLLECTION = "saaCue";
  const DOC_ID = "currentMessage";
  const IDLE_TEXT = "ーーー";
  let db = null;
  let docRef = null;

  const isController = document.body.classList.contains("controller-page");
  const isDisplay = document.body.classList.contains("display-page");

  function setStatus(text) {
    const controllerStatus = document.getElementById("statusText");
    const displayStatus = document.getElementById("displayStatus");
    if (controllerStatus) controllerStatus.textContent = text;
    if (displayStatus) displayStatus.textContent = text;
  }

  function initFirebase() {
    if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
      setStatus("Firebase設定が読み込めません。firebase-config.jsを確認してください。");
      return false;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
      db = firebase.firestore();
      docRef = db.collection(COLLECTION).doc(DOC_ID);
      setStatus("Firebase接続完了");
      return true;
    } catch (error) {
      console.error(error);
      setStatus("Firebase接続エラー: " + error.message);
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

  async function sendMessage(text, action = "message", explicitType = "", sourceButton = null) {
    if (!docRef) {
      setStatus("Firebase未接続です。ページを再読み込みしてください。");
      return;
    }
    const finalText = action === "clear" ? "" : String(text || "").trim();
    const type = classifyMessage(finalText, action, explicitType);
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const displayText = readableMessage(finalText, action);

    setStatus("送信中…");
    const last = document.getElementById("lastSentText");
    if (last) last.textContent = "送信中：" + displayText;
    flashButton(sourceButton, "sending");
    if (navigator.vibrate) navigator.vibrate(35);

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
      setStatus("送信済み・iPad反映待ち");
      if (last) last.textContent = "送信済み：" + displayText;
      flashButton(sourceButton, "sent");
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
    } catch (error) {
      console.error(error);
      setStatus("送信エラー: " + error.message);
      if (last) last.textContent = "送信エラー：" + error.message;
      flashButton(sourceButton, "send-error", 1600);
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
    }
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, "");
  }

  function setupController() {
    document.querySelectorAll(".cue-button").forEach(button => {
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
      meetingButton.addEventListener("click", () => {
        const num = normalizeDigits(meetingInput.value);
        if (!num) { setStatus("例会番号を入力してください。"); return; }
        localStorage.setItem("saaMeetingNumber", num);
        sendMessage(`第${num}回例会`, "message", "meeting", meetingButton);
      });
      meetingInput.addEventListener("keydown", e => { if (e.key === "Enter") meetingButton.click(); });
    }

    const freeInput = document.getElementById("freeMessage");
    const freeButton = document.getElementById("sendFreeButton");
    if (freeButton && freeInput) {
      freeButton.addEventListener("click", () => {
        const msg = freeInput.value.trim();
        if (!msg) { setStatus("自由入力欄に文字を入力してください。"); return; }
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
          setStatus("iPad表示確認済み");
          const last = document.getElementById("lastSentText");
          if (last) last.textContent = "iPad表示中：" + currentText;
        } else if (data.messageId) {
          setStatus("送信済み・iPad反映待ち");
        }
      }, error => {
        console.error(error);
        setStatus("確認受信エラー: " + error.message);
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
    element.style.lineHeight = "1.02";

    const maxW = Math.max(10, box.clientWidth * 0.985);
    const maxH = Math.max(10, box.clientHeight * 0.955);
    const lines = Math.min(2, Math.max(1, countDisplayLines(element)));

    let low = 20;
    let high = Math.max(360, Math.min(window.innerWidth, window.innerHeight) * 1.6);
    let best = low;

    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2;
      element.style.fontSize = `${mid}px`;
      const hLimit = lines === 1 ? maxH : maxH;
      if (element.scrollWidth <= maxW && element.scrollHeight <= hLimit) {
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
