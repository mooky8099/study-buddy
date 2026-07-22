import { useState, useEffect, useRef, useMemo } from "react";
// ▼ Firebase 실시간 DB
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

// ─────────────────────────────────────────────
// 우리집 공부방 — v9-FB "Pastel Clean · 실시간 + 위치"
// · 모든 기기가 Firestore로 같은 데이터를 실시간 공유
// · 학생별 자기 탭만 / 공부로그 / 승인취소 기록 / 위치 공유
// · 완료 체크: 1차=학생 / 2차=부모 명시
// ─────────────────────────────────────────────

// ⚠️ 여기에 본인 Firebase 프로젝트 설정을 붙여넣으세요 (가이드 3장 참고)
//    firebase.google.com → 프로젝트 설정 → "내 앱" → SDK 설정 및 구성 → "구성"
const firebaseConfig = {
  apiKey: "여기에-본인-apiKey",
  authDomain: "여기에-본인.firebaseapp.com",
  projectId: "여기에-본인-projectId",
  storageBucket: "여기에-본인.appspot.com",
  messagingSenderId: "여기에-본인-senderId",
  appId: "여기에-본인-appId",
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
// 온 가족이 같은 문서를 봄: collection "studyroom" 안의 문서 "shared"
const DOC_REF = doc(db, "studyroom", "shared");

const STORAGE_KEY = "studybuddy-v5";
const APP_VERSION = "v9.2-FB";
// 배포(빌드)한 날짜. 코드를 수정해 다시 배포할 때마다 이 값을 그날 날짜로 갱신하면 홈 하단에 자동 반영됩니다.
const LAST_UPDATED = "2026-07-22";
const MASTERS = [
  { name: "이경묵", pw: "6476" },
  { name: "민지선", pw: "5551" },
  { name: "민지혜", pw: "5421" },
];
const ALLOWED_KIDS = ["이서준", "이주아", "권휘"];
// 학생 이름 → 프로필 키 매핑 (학생 로그인 시 자기 탭만 보이게)
const KID_KEY_BY_NAME = { "이서준": "first", "이주아": "second", "권휘": "third" };
const RESET_PW = "0000";
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

const SUBJECTS = [
  { id: "math", label: "수학", dot: "text-sky-500" },
  { id: "eng", label: "영어", dot: "text-rose-500" },
  { id: "kor", label: "국어", dot: "text-amber-500" },
  { id: "sci", label: "과학", dot: "text-emerald-500" },
  { id: "soc", label: "사회", dot: "text-violet-500" },
  { id: "rev", label: "복습", dot: "text-stone-500" },
];

// 파스텔 테마: 서준=블루, 주아=레드, 휘=그린
const THEMES = {
  first: {
    name: "첫째", realName: "이서준", grade: "중1",
    bg: "bg-sky-400", bgHover: "bg-sky-300", bgSoft: "bg-sky-50",
    text: "text-sky-500", textDeep: "text-sky-600", border: "border-sky-300", ring: "#38bdf8",
    grad: "from-sky-300 to-sky-400", glow: "rgba(56, 189, 248, 0.25)",
  },
  second: {
    name: "둘째", realName: "이주아", grade: "초5",
    bg: "bg-rose-400", bgHover: "bg-rose-300", bgSoft: "bg-rose-50",
    text: "text-rose-500", textDeep: "text-rose-600", border: "border-rose-300", ring: "#fb7185",
    grad: "from-rose-300 to-rose-400", glow: "rgba(251, 113, 133, 0.25)",
  },
  third: {
    name: "셋째", realName: "권휘", grade: "중1",
    bg: "bg-emerald-400", bgHover: "bg-emerald-300", bgSoft: "bg-emerald-50",
    text: "text-emerald-500", textDeep: "text-emerald-600", border: "border-emerald-300", ring: "#34d399",
    grad: "from-emerald-300 to-emerald-400", glow: "rgba(52, 211, 153, 0.25)",
  },
};

const now = () => Date.now();
// 로그인 세션은 기기마다 다르므로 Firestore에는 저장하지 않음
const stripSession = (d) => { const { session, ...rest } = d; return rest; };
const isSameDay = (a, b) => {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};
const fmtDate = (ms) => new Date(ms).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const fmtDateTime = (ms) => `${new Date(ms).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} ${fmtTime(ms)}`;
const pad2 = (n) => String(n).padStart(2, "0");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const addMin = (time, dur) => {
  const total = toMin(time) + (dur || 0);
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
};
const fmtRange = (t) => (t.time ? `${t.time}~${addMin(t.time, t.duration || 0)}` : "없음");
const fmtDur = (m) => {
  if (m <= 0) return "0분";
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}시간 ${rem}분` : `${h}시간`;
};
const todayStartMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

const seedProfile = (todos, rewards) => ({
  points: 0, todos, rewards, purchases: [], usedRewards: {},
  timerActive: null, timerLogs: [],
});

const middleSchoolSeed = (prefix) => seedProfile(
  [
    { id: `${prefix}1`, text: "수학 문제집 2쪽 풀기", subject: "math", pts: 10, time: "16:00", duration: 50, studentDone: false, done: false, createdAt: now(), doneAt: null },
    { id: `${prefix}2`, text: "영어 단어 20개 암기", subject: "eng", pts: 10, time: "17:00", duration: 30, studentDone: false, done: false, createdAt: now(), doneAt: null },
  ],
  [
    { id: `${prefix}r1`, name: "게임 30분 이용권", cost: 50 },
    { id: `${prefix}r2`, name: "용돈 1,000원", cost: 100 },
    { id: `${prefix}r3`, name: "주말 늦잠 쿠폰", cost: 80 },
  ]
);

const DEFAULT_DATA = {
  first: middleSchoolSeed("f"),
  second: seedProfile(
    [
      { id: "s1", text: "받아쓰기 연습하기", subject: "kor", pts: 10, time: "15:00", duration: 30, studentDone: false, done: false, createdAt: now(), doneAt: null },
      { id: "s2", text: "영어 동화책 읽기", subject: "eng", pts: 10, time: "16:30", duration: 20, studentDone: false, done: false, createdAt: now(), doneAt: null },
    ],
    [
      { id: "sr1", name: "아이스크림 쿠폰", cost: 30 },
      { id: "sr2", name: "만화책 1권", cost: 60 },
      { id: "sr3", name: "놀이터 1시간", cost: 40 },
    ]
  ),
  third: middleSchoolSeed("h"),
  history: [],
  activityLog: [],
  locations: {},
  users: MASTERS.map((m) => ({ ...m, role: "master", createdAt: now() })),
  loginLogs: [],
  session: null,
};

function startOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}
function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function computeStats(profile, start, end) {
  const inRange = (ms) => ms != null && ms >= start && ms < end;
  const todos = profile.todos.filter((t) => inRange(t.createdAt) || inRange(t.doneAt));
  const doneList = todos.filter((t) => t.done && inRange(t.doneAt));
  const rate = todos.length ? Math.round((doneList.length / todos.length) * 100) : 0;
  const pts = doneList.reduce((s, t) => s + t.pts, 0);
  const bySubject = SUBJECTS.map((s) => {
    const list = todos.filter((t) => t.subject === s.id);
    const d = list.filter((t) => t.done && inRange(t.doneAt)).length;
    return { ...s, total: list.length, done: d, pct: list.length ? Math.round((d / list.length) * 100) : 0 };
  }).filter((s) => s.total > 0);
  return { total: todos.length, done: doneList.length, rate, pts, bySubject };
}

function computeTimerStats(profile, start, end) {
  const logs = (profile.timerLogs || []).filter((l) => l.at >= start && l.at < end);
  const total = logs.reduce((sum, l) => sum + l.minutes, 0);
  const bySubject = SUBJECTS.map((s) => ({
    ...s,
    minutes: logs.filter((l) => l.subject === s.id).reduce((sum, l) => sum + l.minutes, 0),
  })).filter((s) => s.minutes > 0);
  return { total, bySubject, count: logs.length };
}

const card = "bg-white rounded-3xl border border-stone-100 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]";
const input = "bg-stone-50 border border-stone-200 text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 focus:bg-white rounded-2xl transition-colors";
const label = "text-[11px] font-bold tracking-wide text-stone-400";

const SectionLabel = ({ children, accent, right }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <span className={`w-1 h-3.5 rounded-full ${accent || "bg-stone-300"}`}></span>
      <span className="text-xs font-extrabold text-stone-500">{children}</span>
    </div>
    {right}
  </div>
);

// 나눔스퀘어 네오 계열 웹폰트 로드
function FontLoader() {
  useEffect(() => {
    const id = "nanum-square-neo-font";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.1/NanumSquareNeo-Variable.woff2";
    // 위 woff2 직접로드 대신 @font-face 주입
    const style = document.createElement("style");
    style.id = id + "-style";
    style.textContent = `
      @font-face {
        font-family: 'NanumSquareNeo';
        src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.1/NanumSquareNeo-Variable.woff2') format('woff2-variations');
        font-weight: 300 900;
        font-display: swap;
      }
    `;
    document.head.appendChild(style);
  }, []);
  return null;
}

const FONT = { fontFamily: "'NanumSquareNeo', 'Pretendard', -apple-system, sans-serif" };

export default function StudyBuddy() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [kid, setKid] = useState("first");
  const [tab, setTab] = useState("home");
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [targetDate, setTargetDate] = useState(() => todayStartMs());
  const [shareLoc, setShareLoc] = useState(() => {
    try { return localStorage.getItem("studybuddy-shareloc") === "1"; } catch { return false; }
  });
  const toastTimer = useRef(null);

  const currentUser = data.users.find((u) => u.name === data.session) || null;
  const isMaster = currentUser?.role === "master";
  // 학생이면 자기 프로필로 고정, 부모(관리자)면 선택한 탭 사용
  const myKidKey = currentUser ? KID_KEY_BY_NAME[currentUser.name] : null;
  const activeKid = isMaster ? kid : (myKidKey || kid);
  const theme = THEMES[activeKid];
  const profile = data[activeKid];

  // 학생 로그인 시 자기 탭으로 자동 이동 + 관리자 탭 접근 차단
  useEffect(() => {
    if (!isMaster && myKidKey) setKid(myKidKey);
  }, [isMaster, myKidKey]);
  useEffect(() => {
    if (!isMaster && tab === "admin") setTab("home");
  }, [isMaster, tab]);

  // 위치 공유 반복 보고 (학생이 동의 + 학생 계정일 때만)
  useEffect(() => {
    if (isMaster || !myKidKey || !shareLoc || !loaded) return;
    if (!("geolocation" in navigator)) return;
    let stopped = false;
    const report = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => { if (!stopped) updateMyLocation(pos.coords); },
        () => {},
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 }
      );
    };
    report();
    const id = setInterval(report, 120000); // 2분마다
    return () => { stopped = true; clearInterval(id); };
  }, [isMaster, myKidKey, shareLoc, loaded]);

  const toggleShareLoc = () => {
    const next = !shareLoc;
    if (next) {
      if (!("geolocation" in navigator)) { showToast("이 기기는 위치를 지원하지 않아요"); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setShareLoc(true);
          try { localStorage.setItem("studybuddy-shareloc", "1"); } catch {}
          updateMyLocation(pos.coords);
          showToast("위치 공유를 켰어요");
        },
        () => showToast("위치 권한이 필요해요. 브라우저 설정에서 허용해 주세요"),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    } else {
      setShareLoc(false);
      try { localStorage.setItem("studybuddy-shareloc", "0"); } catch {}
      showToast("위치 공유를 껐어요");
    }
  };

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKbOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  // 원격(다른 기기)에서 온 변경인지 표시 → 저장 루프 방지
  const remoteEcho = useRef(false);

  // ① 실시간 구독: Firestore 문서가 바뀔 때마다 자동으로 화면 갱신
  useEffect(() => {
    // 저장된 프로필에 누락된 키만 기본값으로 채우고, 저장된 값(포인트·할일·보상·구매·사용·타이머 등)은 절대 덮어쓰지 않음
    const normProfile = (saved, fallback) => {
      const base = saved || fallback || {};
      return {
        points: base.points ?? 0,
        todos: base.todos ?? [],
        rewards: base.rewards ?? [],
        purchases: base.purchases ?? [],
        usedRewards: base.usedRewards ?? {},
        timerActive: base.timerActive ?? null,
        timerLogs: base.timerLogs ?? [],
        // 미래 버전에서 추가될 수 있는 알 수 없는 필드도 그대로 보존
        ...base,
      };
    };
    const mergeMasters = (users) => {
      const merged = [...(users || [])];
      MASTERS.forEach((m) => {
        if (!merged.some((u) => u.name === m.name)) merged.push({ ...m, role: "master", createdAt: now() });
      });
      return merged.length ? merged : DEFAULT_DATA.users;
    };

    const unsub = onSnapshot(
      DOC_REF,
      (snap) => {
        if (snap.exists()) {
          const parsed = snap.data();
          remoteEcho.current = true; // 이번 setData는 원격발 → 다시 저장하지 않음
          setData((prevLocal) => ({
            // 기본값을 먼저 깔고, 저장된 값으로 덮어써서 "저장된 내역은 항상 유지 + 새 필드만 보강"
            ...DEFAULT_DATA,
            ...parsed,
            first: normProfile(parsed.first, DEFAULT_DATA.first),
            second: normProfile(parsed.second, DEFAULT_DATA.second),
            third: normProfile(parsed.third, DEFAULT_DATA.third),
            history: parsed.history || [],
            activityLog: parsed.activityLog || [],
            locations: parsed.locations || {},
            loginLogs: parsed.loginLogs || [],
            users: mergeMasters(parsed.users),
            // 로그인 세션은 기기마다 다름 → 원격값 대신 이 기기 값 유지
            session: prevLocal.session,
          }));
        } else {
          // 문서가 아직 없으면(처음 실행) 기본 데이터로 최초 생성
          setDoc(DOC_REF, stripSession(DEFAULT_DATA)).catch((e) => console.error("초기 생성 실패:", e));
        }
        setLoaded(true);
      },
      (err) => {
        console.error("실시간 연결 오류:", err);
        setLoaded(true); // 오류여도 화면은 띄움(오프라인 등)
      }
    );
    return () => unsub();
  }, []);

  // ② 로컬 변경을 Firestore에 저장 (원격발 변경은 건너뜀 → 무한루프 방지)
  useEffect(() => {
    if (!loaded) return;
    if (remoteEcho.current) { remoteEcho.current = false; return; }
    (async () => {
      try { await setDoc(DOC_REF, stripSession(data)); }
      catch (e) { console.error("저장 실패:", e); }
    })();
  }, [data, loaded]);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const actor = () => currentUser?.name || "알 수 없음";
  const pushHistory = (prev, entry) =>
    [{ id: `h${now()}${Math.random().toString(36).slice(2, 6)}`, at: now(), actor: actor(), ...entry }, ...prev.history].slice(0, 300);
  const pushHistoryAs = (prev, actorName, entry) =>
    [{ id: `h${now()}${Math.random().toString(36).slice(2, 6)}`, at: now(), actor: actorName, ...entry }, ...prev.history].slice(0, 300);

  const updateProfile = (fn, logEntry) =>
    setData((prev) => {
      const next = { ...prev, [activeKid]: fn(prev[activeKid]) };
      if (logEntry) next.history = pushHistory(prev, { kidKey: activeKid, ...logEntry });
      return next;
    });

  // 공부로그: 온 가족이 함께 보는 활동 피드 (사람이 읽기 쉬운 한 줄 메시지)
  // kind: "start" | "stop" | "buy" | "approve" | "done" 등, text: 완성된 문장
  const logActivity = (kind, text) =>
    setData((prev) => ({
      ...prev,
      activityLog: [
        { id: `a${now()}${Math.random().toString(36).slice(2, 6)}`, at: now(), actor: actor(), kidKey: activeKid, kind, text },
        ...(prev.activityLog || []),
      ].slice(0, 200),
    }));

  // 위치 공유: 학생 기기가 자기 위치를 저장 (동의한 경우에만)
  const updateMyLocation = (coords) =>
    setData((prev) => ({
      ...prev,
      locations: {
        ...(prev.locations || {}),
        [activeKid]: { lat: coords.latitude, lng: coords.longitude, acc: Math.round(coords.accuracy || 0), at: now(), name: currentUser?.name || "" },
      },
    }));

  const login = (name, pw) => {
    const user = data.users.find((u) => u.name === name.trim());
    const ok = !!user && user.pw === pw;
    setData((prev) => ({
      ...prev,
      loginLogs: [{ id: `l${now()}`, name: name.trim(), at: now(), ok }, ...prev.loginLogs].slice(0, 200),
      session: ok ? user.name : prev.session,
    }));
    if (!ok) showToast("이름 또는 비밀번호가 올바르지 않아요");
    else showToast(`${user.name}님, 어서오세요`);
    return ok;
  };

  const signup = (name, pw) => {
    const n = (name || "").trim();
    if (!ALLOWED_KIDS.includes(n)) { showToast("등록된 학생만 가입할 수 있어요"); return false; }
    if (!/^\d{4}$/.test(pw)) return showToast("비밀번호는 숫자 4자리예요"), false;
    if (data.users.some((u) => u.name === n)) return showToast("이미 가입된 계정이에요. 로그인해 주세요"), false;
    setData((prev) => ({
      ...prev,
      users: [...prev.users, { name: n, pw, role: "student", createdAt: now() }],
      loginLogs: [{ id: `l${now()}`, name: n, at: now(), ok: true }, ...prev.loginLogs].slice(0, 200),
      session: n,
      history: pushHistoryAs(prev, n, { kidKey: null, action: "회원가입", detail: `"${n}" 계정 생성` }),
    }));
    showToast(`${n}님, 가입 완료`);
    return true;
  };

  const logout = () => setData((prev) => ({ ...prev, session: null }));

  const resetUserPw = (name) => {
    setData((prev) => ({
      ...prev,
      users: prev.users.map((u) => (u.name === name ? { ...u, pw: RESET_PW } : u)),
      history: pushHistory(prev, { kidKey: null, action: "비번 초기화", detail: `"${name}"의 비밀번호를 ${RESET_PW}으로 초기화` }),
    }));
    showToast(`"${name}" 비밀번호 초기화 완료`);
  };

  const findConflict = (time, duration, excludeId = null) => {
    if (!time) return null;
    const s = toMin(time);
    const e = s + (duration || 1);
    return (
      profile.todos.find((t) => {
        if (t.id === excludeId || !t.time || !isSameDay(t.createdAt, targetDate)) return false;
        const ts = toMin(t.time);
        const te = ts + (t.duration || 1);
        return s < te && ts < e;
      }) || null
    );
  };

  const addTodo = (text, subject, pts, time, duration) => {
    const conflict = findConflict(time, duration);
    if (conflict) { showToast(`${fmtRange(conflict)} "${conflict.text}"와 시간이 겹쳐요`); return false; }
    const isToday = isSameDay(targetDate, now());
    const createdAt = isToday ? now() : targetDate;
    updateProfile(
      (p) => ({
        ...p,
        todos: [
          { id: `t${now()}`, text, subject, pts, time: time || null, duration: time ? duration : null, studentDone: false, done: false, createdAt, doneAt: null },
          ...p.todos,
        ],
      }),
      { action: "추가", detail: `${!isToday ? `[${new Date(targetDate).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}] ` : ""}"${text}"${time ? ` (${time}~${addMin(time, duration)}, ${duration}분)` : ""} · ${SUBJECTS.find((s) => s.id === subject)?.label} · ${pts}P` }
    );
    showToast("할 일을 추가했어요");
    return true;
  };

  const editTodo = (id, newText, newTime, newDuration) => {
    const target = profile.todos.find((t) => t.id === id);
    if (!target) return false;
    const conflict = newTime ? findConflict(newTime, newDuration, id) : null;
    if (conflict) { showToast(`${fmtRange(conflict)} "${conflict.text}"와 시간이 겹쳐요`); return false; }
    const next = { time: newTime || null, duration: newTime ? newDuration : null };
    const changes = [];
    if (target.text !== newText) changes.push(`내용 "${target.text}" → "${newText}"`);
    if ((target.time || "") !== (next.time || "") || (target.duration || 0) !== (next.duration || 0)) {
      changes.push(`시간 ${fmtRange(target)} → ${fmtRange(next)}`);
    }
    if (changes.length === 0) return true;
    updateProfile(
      (p) => ({ ...p, todos: p.todos.map((t) => (t.id === id ? { ...t, text: newText, ...next } : t)) }),
      { action: "수정", detail: changes.join(", ") }
    );
    showToast("수정했어요");
    return true;
  };

  const toggleStudent = (id) => {
    const target = profile.todos.find((t) => t.id === id);
    if (!target) return;
    if (target.done) { showToast("부모 확인이 끝난 항목이에요"); return; }
    const nowChecked = !target.studentDone;
    updateProfile(
      (p) => ({ ...p, todos: p.todos.map((t) => (t.id === id ? { ...t, studentDone: nowChecked } : t)) }),
      { action: nowChecked ? "1차 완료" : "1차 취소", detail: `"${target.text}"${nowChecked ? " — 부모 확인 대기" : ""}` }
    );
    if (nowChecked) {
      logActivity("done", `${theme.realName}님이 "${target.text}"을(를) 완료했습니다 (부모 확인 대기)`);
      showToast("1차 완료 — 부모 확인 대기");
    }
  };

  const toggleParent = (id) => {
    if (!isMaster) { showToast("2차 확인은 부모(관리자)만 가능해요"); return; }
    const target = profile.todos.find((t) => t.id === id);
    if (!target) return;
    if (!target.done && !target.studentDone) { showToast("학생 1차 체크가 먼저 필요해요"); return; }
    const approve = !target.done;
    updateProfile(
      (p) => ({
        ...p,
        todos: p.todos.map((t) => (t.id === id ? { ...t, done: approve, doneAt: approve ? now() : null } : t)),
        points: Math.max(0, p.points + (approve ? target.pts : -target.pts)),
      }),
      { action: approve ? "2차 승인" : "2차 승인 취소", detail: approve ? `"${target.text}" (+${target.pts}P 지급)` : `"${target.text}" (승인 취소 · ${target.pts}P 반납)` }
    );
    if (approve) logActivity("approve", `${currentUser.name}님이 ${theme.realName}님의 "${target.text}"을(를) 승인했습니다 (+${target.pts}P)`);
    else logActivity("cancel", `${currentUser.name}님이 ${theme.realName}님의 "${target.text}" 승인을 취소했습니다 (${target.pts}P 반납)`);
    showToast(approve ? `승인 완료 · +${target.pts}P` : `승인 취소 · ${target.pts}P 반납`);
  };

  const deleteTodo = (id) => {
    const target = profile.todos.find((t) => t.id === id);
    updateProfile(
      (p) => ({ ...p, todos: p.todos.filter((t) => t.id !== id) }),
      { action: "삭제", detail: `"${target?.text || ""}"${target?.done ? " (승인 완료 항목)" : target?.studentDone ? " (1차 완료 항목)" : ""}` }
    );
  };

  const addReward = (name, cost) => {
    if (!isMaster) return showToast("부모(관리자)만 보상을 추가할 수 있어요"), false;
    updateProfile(
      (p) => ({ ...p, rewards: [...p.rewards, { id: `r${now()}`, name, cost }] }),
      { action: "보상 추가", detail: `"${name}" (${cost}P)` }
    );
    showToast("보상을 추가했어요");
    return true;
  };
  const deleteReward = (id) => {
    if (!isMaster) return;
    const target = profile.rewards.find((r) => r.id === id);
    updateProfile(
      (p) => ({ ...p, rewards: p.rewards.filter((r) => r.id !== id) }),
      { action: "보상 삭제", detail: `"${target?.name || ""}"` }
    );
  };
  const editReward = (id, name, cost) => {
    if (!isMaster) return false;
    const target = profile.rewards.find((r) => r.id === id);
    if (!target) return false;
    const changes = [];
    if (target.name !== name) changes.push(`이름 "${target.name}" → "${name}"`);
    if (target.cost !== cost) changes.push(`포인트 ${target.cost}P → ${cost}P`);
    if (changes.length === 0) return true;
    updateProfile(
      (p) => ({ ...p, rewards: p.rewards.map((r) => (r.id === id ? { ...r, name, cost } : r)) }),
      { action: "보상 수정", detail: changes.join(", ") }
    );
    showToast("보상을 수정했어요");
    return true;
  };
  const buyReward = (reward) => {
    if (profile.points < reward.cost) {
      showToast("교환할 포인트가 부족합니다");
      return false;
    }
    updateProfile(
      (p) => {
        if (p.points < reward.cost) return p;
        return {
          ...p,
          points: p.points - reward.cost,
          purchases: [{ id: `p${now()}`, name: reward.name, cost: reward.cost, at: now() }, ...p.purchases],
        };
      },
      { action: "보상 교환", detail: `"${reward.name}" (-${reward.cost}P)` }
    );
    logActivity("buy", `${theme.realName}님이 ${reward.cost}포인트를 ${reward.name}(으)로 교환했습니다`);
    showToast(`'${reward.name}' 교환 완료`);
    return true;
  };

  // 보유 교환권 사용 처리 (관리자만): 해당 보상 이름의 사용 개수를 1 늘림
  const useOwnedReward = (rewardName) => {
    if (!isMaster) { showToast("보유 개수 차감은 부모(관리자)만 가능해요"); return; }
    updateProfile(
      (p) => {
        const purchasedCount = (p.purchases || []).filter((x) => x.name === rewardName).length;
        const usedCount = (p.usedRewards && p.usedRewards[rewardName]) || 0;
        if (usedCount >= purchasedCount) return p; // 남은 게 없으면 변화 없음
        return { ...p, usedRewards: { ...(p.usedRewards || {}), [rewardName]: usedCount + 1 } };
      },
      { action: "보상 사용", detail: `"${rewardName}" 1개 사용 처리` }
    );
    logActivity("use", `${currentUser.name}님이 ${theme.realName}님의 "${rewardName}" 1개를 사용 처리했습니다`);
    showToast(`"${rewardName}" 1개 차감했어요`);
  };

  // 사용 처리 취소(되돌리기): 사용 개수를 1 줄임
  const undoUsedReward = (rewardName) => {
    if (!isMaster) return;
    updateProfile(
      (p) => {
        const usedCount = (p.usedRewards && p.usedRewards[rewardName]) || 0;
        if (usedCount <= 0) return p;
        return { ...p, usedRewards: { ...(p.usedRewards || {}), [rewardName]: usedCount - 1 } };
      },
      { action: "보상 사용 취소", detail: `"${rewardName}" 사용 1개 복구` }
    );
    showToast(`"${rewardName}" 1개 복구했어요`);
  };

  const startTimer = (subject) => {
    const subjLabel = SUBJECTS.find((s) => s.id === subject)?.label;
    updateProfile((p) => ({ ...p, timerActive: { subject, startAt: now() } }), null);
    logActivity("start", `${theme.realName}님이 ${subjLabel} 공부를 시작했습니다`);
    showToast(`${subjLabel} 타이머 시작`);
  };

  const stopTimer = () => {
    const active = profile.timerActive;
    if (!active) return;
    const subjLabel = SUBJECTS.find((s) => s.id === active.subject)?.label;
    const minutes = Math.round((Date.now() - active.startAt) / 60000);
    updateProfile(
      (p) => ({
        ...p,
        timerActive: null,
        timerLogs: minutes > 0
          ? [{ id: `tm${now()}`, subject: active.subject, minutes, at: now() }, ...(p.timerLogs || [])]
          : (p.timerLogs || []),
      }),
      minutes > 0
        ? { action: "타이머 기록", detail: `${subjLabel} ${fmtDur(minutes)}` }
        : null
    );
    logActivity("stop", minutes > 0
      ? `${theme.realName}님이 ${subjLabel} 공부를 종료했습니다 (${fmtDur(minutes)})`
      : `${theme.realName}님이 ${subjLabel} 타이머를 종료했습니다`);
    showToast(minutes > 0 ? `${subjLabel} ${fmtDur(minutes)} 기록` : "1분 미만은 저장 안 돼요");
  };

  const weekStats = useMemo(() => computeStats(profile, startOfWeek(), now() + 1), [profile]);

  if (!loaded) {
    return (
      <div style={FONT} className="min-h-screen bg-stone-50 flex flex-col items-center justify-center gap-3 text-stone-400 text-sm">
        <FontLoader />
        <div className="w-8 h-8 rounded-full border-2 border-stone-200 border-t-stone-400 animate-spin" />
        실시간 서버에 연결 중…
      </div>
    );
  }

  if (!currentUser) return <><FontLoader /><AuthScreen login={login} signup={signup} toast={toast} /></>;

  return (
    <div style={FONT} className="min-h-screen bg-stone-50 text-stone-900">
      <FontLoader />
      <div className="max-w-md mx-auto min-h-screen flex flex-col relative">
        {/* ── 헤더 ── */}
        <header className={`sticky top-0 z-20 px-5 bg-stone-50/90 backdrop-blur-md border-b border-stone-100 overflow-hidden transition-all duration-200 ${
          kbOpen ? "max-h-0 py-0 border-transparent opacity-0 pointer-events-none" : "max-h-44 pt-4 pb-3"
        }`}>
          <div className="flex items-center justify-between mb-2.5 px-0.5">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isMaster ? "bg-amber-400" : theme.bg}`}></div>
              <p className="text-xs font-bold text-stone-600">
                {currentUser.name}
                {isMaster && <span className="text-amber-500 ml-1.5 text-[10px] font-extrabold">부모</span>}
              </p>
            </div>
            <button onClick={logout} className="text-[11px] font-bold text-stone-400 py-1 px-2 active:text-stone-700">
              로그아웃
            </button>
          </div>
          {isMaster ? (
            <div className="flex gap-1.5">
              {Object.entries(THEMES).map(([key, t]) => {
                const active = kid === key;
                return (
                  <button
                    key={key}
                    onClick={() => setKid(key)}
                    className={`flex-1 h-13 py-2 rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 ${
                      active ? `${t.bg} text-white shadow-sm` : "bg-white border border-stone-100 text-stone-400"
                    }`}
                  >
                    <span className={`text-[10px] font-bold ${active ? "text-white/80" : "text-stone-400"}`}>
                      {t.name}·{t.grade}
                    </span>
                    <span className="text-sm font-extrabold leading-tight mt-0.5">{t.realName}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={`h-13 py-2 rounded-2xl flex items-center justify-center ${theme.bg} text-white shadow-sm`}>
              <span className="text-[11px] font-bold text-white/80 mr-2">{theme.name}·{theme.grade}</span>
              <span className="text-base font-extrabold">{theme.realName}</span>
              <span className="text-[10px] font-bold text-white/70 ml-2">내 공부방</span>
            </div>
          )}
        </header>

        {/* ── 본문 ── */}
        <main className={`flex-1 px-5 overflow-y-auto ${kbOpen ? "pt-2 pb-6" : "pt-4 pb-24"}`}>
          {tab === "home" && <HomeTab theme={theme} profile={profile} stats={weekStats} toggleStudent={toggleStudent} toggleParent={toggleParent} goTab={setTab} setTargetDate={setTargetDate} startTimer={startTimer} stopTimer={stopTimer} isMaster={isMaster} activityLog={data.activityLog || []} shareLoc={shareLoc} toggleShareLoc={toggleShareLoc} />}
          {tab === "todo" && <TodoTab theme={theme} profile={profile} toggleStudent={toggleStudent} toggleParent={toggleParent} addTodo={addTodo} editTodo={editTodo} deleteTodo={deleteTodo} targetDate={targetDate} setTargetDate={setTargetDate} isMaster={isMaster} />}
          {tab === "shop" && <ShopTab theme={theme} profile={profile} buyReward={buyReward} addReward={addReward} deleteReward={deleteReward} editReward={editReward} isMaster={isMaster} useOwnedReward={useOwnedReward} undoUsedReward={undoUsedReward} />}
          {tab === "dash" && <DashTab theme={theme} profile={profile} />}
          {tab === "admin" && <AdminTab data={data} isMaster={isMaster} resetUserPw={resetUserPw} locations={data.locations || {}} />}
        </main>

        {toast && (
          <div className={`fixed left-1/2 -translate-x-1/2 z-30 w-max max-w-xs px-5 py-3 rounded-full bg-stone-800 text-white text-sm font-bold shadow-xl text-center ${
            kbOpen ? "top-6" : "bottom-24"
          }`}>
            {toast}
          </div>
        )}

        {/* ── 하단 탭 ── */}
        <nav className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-20 bg-white/95 backdrop-blur-md border-t border-stone-100 px-2 pt-1.5 pb-3 transition-transform duration-200 ${
          kbOpen ? "translate-y-full pointer-events-none" : ""
        }`}>
          <div className="flex">
            {[
              { id: "home", label: "홈", icon: HomeIcon },
              { id: "todo", label: "할일", icon: CheckIcon },
              { id: "shop", label: "상점", icon: GiftIcon },
              { id: "dash", label: "통계", icon: ChartIcon },
              ...(isMaster ? [{ id: "admin", label: "관리자", icon: LockIcon }] : []),
            ].map((t) => {
              const active = tab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 h-14 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
                    active ? theme.text : "text-stone-400"
                  }`}
                >
                  <Icon />
                  <span className={`text-[10px] ${active ? "font-extrabold" : "font-medium"}`}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

// ── 아이콘 ──
const HomeIcon = () => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>;
const CheckIcon = () => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>;
const GiftIcon = () => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,12 20,22 4,22 4,12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>;
const ChartIcon = () => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
const LockIcon = () => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
const ArrowLeftIcon = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/></svg>;
const ArrowRightIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>;

// ═══════════ 로그인 / 회원가입 ═══════════
function AuthScreen({ login, signup, toast }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pickedKid, setPickedKid] = useState("");

  const submit = () => {
    if (mode === "login") {
      if (!name.trim() || pw.length < 4) return;
      const ok = login(name, pw);
      if (ok) { setName(""); setPw(""); } else setPw("");
    } else {
      if (!pickedKid || pw.length < 4) return;
      const ok = signup(pickedKid, pw);
      if (ok) { setPickedKid(""); setPw(""); } else setPw("");
    }
  };

  return (
    <div style={FONT} className="min-h-screen bg-stone-50 text-stone-900 flex items-center justify-center px-5">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-2 mb-8">
          <div className="w-14 h-14 mx-auto rounded-3xl bg-gradient-to-br from-sky-300 via-rose-300 to-emerald-300 flex items-center justify-center text-2xl shadow-sm">📚</div>
          <h1 className="text-3xl font-extrabold tracking-tight mt-3">우리집 공부방</h1>
          <p className="text-xs font-bold text-stone-400">함께 공부하고 포인트 모으기</p>
        </div>

        <div className="bg-white rounded-full border border-stone-100 p-1.5 flex gap-1 shadow-sm">
          {[{ id: "login", label: "로그인" }, { id: "signup", label: "회원가입" }].map((m) => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setPw(""); setName(""); setPickedKid(""); }}
              className={`flex-1 h-11 rounded-full text-sm font-bold transition-all active:scale-95 ${
                mode === m.id ? "bg-stone-800 text-white" : "text-stone-400"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className={`${card} p-6 space-y-4`}>
          {mode === "login" ? (
            <>
              <div>
                <label className={label}>이름 (ID)</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름을 입력하세요" className={`w-full h-14 px-4 mt-2 text-base ${input}`} />
              </div>
              <div>
                <label className={label}>비밀번호</label>
                <input type="password" inputMode="numeric" maxLength={4} value={pw} onChange={(e) => setPw(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••" className={`w-full h-14 px-4 mt-2 text-lg tracking-[0.5em] text-center ${input}`} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={label}>이름을 선택하세요</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {ALLOWED_KIDS.map((k) => (
                    <button key={k} onClick={() => setPickedKid(k)} className={`h-14 rounded-2xl border transition-all active:scale-95 text-sm font-bold ${
                      pickedKid === k ? "bg-stone-800 text-white border-transparent" : "bg-stone-50 border-stone-200 text-stone-600"
                    }`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={label}>비밀번호 (숫자 4자리)</label>
                <input type="password" inputMode="numeric" maxLength={4} value={pw} onChange={(e) => setPw(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••" className={`w-full h-14 px-4 mt-2 text-lg tracking-[0.5em] text-center ${input}`} />
              </div>
              <p className="text-[11px] text-stone-400 px-1 leading-relaxed">
                등록된 세 명(이서준·이주아·권휘)만 가입할 수 있어요. 부모(관리자)는 로그인만 가능합니다.
              </p>
            </>
          )}
          <button
            onClick={submit}
            disabled={mode === "login" ? (!name.trim() || pw.length < 4) : (!pickedKid || pw.length < 4)}
            className="w-full h-14 rounded-2xl bg-stone-800 text-white text-base font-extrabold transition-all active:scale-95 disabled:opacity-30"
          >
            {mode === "login" ? "로그인" : "가입하기"}
          </button>
        </div>

        {toast && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-30 w-max max-w-xs px-5 py-3 rounded-full bg-stone-800 text-white text-sm font-bold shadow-xl text-center">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════ 혼공 타이머 (컴팩트) ═══════════
function TimerWidget({ theme, profile, startTimer, stopTimer }) {
  const [subject, setSubject] = useState("math");
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const active = profile.timerActive;

  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - active.startAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  const ts = todayStartMs();
  const todayLogs = (profile.timerLogs || []).filter((l) => l.at >= ts);
  const bySubject = SUBJECTS.map((s) => ({
    ...s,
    minutes: todayLogs.filter((l) => l.subject === s.id).reduce((sum, l) => sum + l.minutes, 0),
  })).filter((s) => s.minutes > 0);
  const totalMin = todayLogs.reduce((sum, l) => sum + l.minutes, 0);
  const runningSubject = active ? SUBJECTS.find((s) => s.id === active.subject) : null;
  const runningMin = active ? Math.floor(elapsed / 60) : 0;
  const projectedTotal = totalMin + runningMin;

  const fmtElapsed = (sec) => `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`;

  return (
    <div className={`${card} p-4`}>
      {/* 컴팩트 한 줄: 타이머 + 시작/종료 */}
      <div className="flex items-center gap-3">
        <div className={`flex-1 h-14 rounded-2xl flex items-center justify-center gap-2 ${active ? theme.bgSoft : "bg-stone-50"}`}>
          {active && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0"></span>}
          <span className={`text-2xl font-extrabold tabular-nums tracking-tight ${active ? theme.textDeep : "text-stone-300"}`}>
            {fmtElapsed(elapsed)}
          </span>
          {active && <span className={`text-xs font-bold ${runningSubject?.dot}`}>{runningSubject?.label}</span>}
        </div>
        {!active ? (
          <button onClick={() => startTimer(subject)} className={`h-14 px-6 rounded-2xl text-white text-sm font-extrabold active:scale-95 ${theme.bg}`}>
            시작
          </button>
        ) : (
          <button onClick={stopTimer} className="h-14 px-6 rounded-2xl bg-stone-800 text-white text-sm font-extrabold active:scale-95">
            종료
          </button>
        )}
      </div>

      {/* 과목선택 + 오늘 누적 요약 (한 줄) */}
      <div className="flex items-center justify-between mt-3">
        {!active ? (
          <div className="flex gap-1 flex-wrap">
            {SUBJECTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSubject(s.id)}
                className={`h-7 px-2.5 rounded-full text-[11px] font-bold transition-all active:scale-95 ${
                  subject === s.id ? `${theme.bg} text-white` : `bg-stone-100 ${s.dot}`
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs font-bold text-stone-400">🔥 집중하는 중</span>
        )}
        <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className={label}>오늘</span>
          <span className={`text-sm font-extrabold ${theme.text}`}>{fmtDur(projectedTotal)}</span>
        </button>
      </div>

      {/* 펼치면 과목별 기록 */}
      {expanded && bySubject.length > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-100 space-y-1.5">
          {bySubject.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-xs">
              <span className={`font-bold ${s.dot}`}>● {s.label}</span>
              <span className="font-extrabold text-stone-600 tabular-nums">{fmtDur(s.minutes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════ 홈 탭 ═══════════
function HomeTab({ theme, profile, stats, toggleStudent, toggleParent, goTab, setTargetDate, startTimer, stopTimer, isMaster, activityLog, shareLoc, toggleShareLoc }) {
  const todayIdx = (new Date().getDay() + 6) % 7;
  const [sel, setSel] = useState(todayIdx);
  const [logOpen, setLogOpen] = useState(false);

  const week = useMemo(() => {
    const ws = startOfWeek();
    return DAY_LABELS.map((label, i) => {
      const ds = ws + i * 86400000;
      const list = profile.todos
        .filter((t) => isSameDay(t.createdAt, ds))
        .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : 1));
      return { label, ds, date: new Date(ds).getDate(), month: new Date(ds).getMonth() + 1, list, done: list.filter((t) => t.done).length };
    });
  }, [profile]);

  const selDay = week[sel];
  const weekTitle = useMemo(() => {
    const f = new Date(week[0].ds);
    const l = new Date(week[6].ds);
    if (f.getMonth() === l.getMonth()) return `${f.getMonth() + 1}.${f.getDate()} - ${l.getDate()}`;
    return `${f.getMonth() + 1}.${f.getDate()} - ${l.getMonth() + 1}.${l.getDate()}`;
  }, [week]);

  const openTodoForDay = (ds) => { setTargetDate(ds); goTab("todo"); };

  return (
    <div className="space-y-3.5">
      <TimerWidget theme={theme} profile={profile} startTimer={startTimer} stopTimer={stopTimer} />

      {/* ── 컴팩트 포인트 바 ── */}
      <div className={`${card} p-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-2xl ${theme.bg} flex items-center justify-center text-white text-lg font-extrabold shrink-0`}>
            {theme.realName[0]}
          </div>
          <div>
            <p className={label}>{theme.realName} 포인트</p>
            <p className="text-2xl font-extrabold tracking-tight tabular-nums leading-tight">
              {profile.points}<span className={`text-sm font-bold ml-0.5 ${theme.text}`}>P</span>
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={label}>이번 주</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-16 h-1.5 rounded-full bg-stone-100 overflow-hidden">
              <div className={`h-full rounded-full ${theme.bg}`} style={{ width: `${stats.rate}%` }} />
            </div>
            <span className={`text-sm font-extrabold ${theme.text} tabular-nums`}>{stats.rate}%</span>
          </div>
        </div>
      </div>

      {/* ── 주간 캘린더 ── */}
      <div className={`${card} p-4`}>
        <SectionLabel accent={theme.bg} right={<span className="text-[11px] font-bold text-stone-400 tabular-nums">{weekTitle}</span>}>
          이번 주
        </SectionLabel>
        <div className="grid grid-cols-7 gap-1 mt-3">
          {week.map((d, i) => {
            const active = sel === i;
            const isToday = i === todayIdx;
            const allDone = d.list.length > 0 && d.done === d.list.length;
            return (
              <button
                key={i}
                onClick={() => setSel(i)}
                className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
                  active ? `${theme.bg} text-white` : isToday ? `bg-white border-2 ${theme.border}` : "bg-stone-50"
                }`}
              >
                <span className={`text-[10px] font-bold ${active ? "text-white/70" : "text-stone-400"}`}>{d.label}</span>
                <span className={`text-base font-extrabold tabular-nums leading-none ${active ? "text-white" : "text-stone-800"}`}>{d.date}</span>
                <span className={`text-[9px] font-bold tabular-nums ${
                  d.list.length === 0 ? active ? "text-white/40" : "text-stone-300"
                    : allDone ? (active ? "text-white" : theme.text) : active ? "text-white/90" : "text-stone-500"
                }`}>
                  {d.list.length === 0 ? "·" : allDone ? "✓" : `${d.done}/${d.list.length}`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-extrabold text-stone-700">
              {selDay.month}.{selDay.date} <span className="text-stone-400 font-medium">({selDay.label})</span>
              <span className="text-stone-400 text-xs font-medium ml-1.5">{selDay.done}/{selDay.list.length}</span>
            </p>
            <button onClick={() => goTab("todo")} className={`flex items-center gap-1 text-xs font-bold ${theme.text} active:scale-95`}>
              전체 <ArrowRightIcon />
            </button>
          </div>
          {selDay.list.length === 0 ? (
            <p className="text-xs text-stone-400 py-2">이 날 등록된 할 일이 없어요.</p>
          ) : (
            selDay.list.map((t) => (
              <TodoItem key={t.id} todo={t} theme={theme} onStudent={toggleStudent} onParent={toggleParent} compact />
            ))
          )}
          <button
            onClick={() => openTodoForDay(selDay.ds)}
            className={`w-full h-11 rounded-2xl border border-dashed ${theme.border} ${theme.text} text-sm font-bold active:scale-95 mt-1`}
          >
            + {selDay.month}.{selDay.date}에 할 일 추가
          </button>
        </div>
      </div>

      {/* ── 공부로그 (온 가족 활동 피드) ── */}
      <ActivityFeed theme={theme} activityLog={activityLog} open={logOpen} setOpen={setLogOpen} />

      {/* ── 위치 공유 (학생 본인만 표시) ── */}
      {!isMaster && (
        <div className={`${card} px-4 py-3 flex items-center gap-3`}>
          <span className="text-base shrink-0">📍</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-extrabold text-stone-700">부모님께 내 위치 공유</p>
            <p className="text-[10px] text-stone-400 leading-snug mt-0.5">
              {shareLoc ? "위치를 공유하는 중이에요 (2분마다 갱신)" : "켜면 부모님이 내 위치를 지도로 볼 수 있어요"}
            </p>
          </div>
          <button
            onClick={toggleShareLoc}
            className={`w-12 h-7 rounded-full shrink-0 transition-all relative ${shareLoc ? theme.bg : "bg-stone-200"}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${shareLoc ? "left-[22px]" : "left-0.5"}`}></span>
          </button>
        </div>
      )}

      {/* ── 버전 / 최종 수정일 ── */}
      <p className="text-center text-[10px] font-medium text-stone-400 pt-1 pb-2 tabular-nums">
        우리집 공부방 {APP_VERSION} · 최종 수정 {LAST_UPDATED}
      </p>
    </div>
  );
}

// ═══════════ 공부로그 피드 ═══════════
function ActivityFeed({ theme, activityLog, open, setOpen }) {
  const logs = activityLog || [];
  const latest = logs[0];

  const KIND_DOT = {
    start: "bg-sky-400", stop: "bg-emerald-400", done: "bg-amber-400",
    approve: "bg-violet-400", buy: "bg-rose-400", cancel: "bg-orange-400", use: "bg-teal-400",
  };

  // 날짜별 그룹핑 (펼친 상태에서만 사용)
  const groups = useMemo(() => {
    const g = [];
    logs.forEach((a) => {
      const key = new Date(a.at).toDateString();
      const last = g[g.length - 1];
      if (last && last.key === key) last.items.push(a);
      else g.push({ key, dateMs: a.at, items: [a] });
    });
    return g;
  }, [logs]);

  return (
    <div className={`${card} overflow-hidden`}>
      {/* 접힌 상태: 한 줄 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 active:bg-stone-50"
      >
        <span className="text-sm shrink-0">📓</span>
        <span className={label + " shrink-0"}>공부로그</span>
        <span className="flex-1 min-w-0 text-left text-xs font-medium text-stone-500 truncate">
          {latest ? latest.text : "아직 활동 기록이 없어요"}
        </span>
        <span className={`shrink-0 text-stone-300 transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
          <ArrowRightIcon />
        </span>
      </button>

      {/* 펼친 상태: 최신순 전체 리스트 */}
      {open && (
        <div className="border-t border-stone-100 max-h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-xs text-stone-400 text-center py-8">아직 활동 기록이 없어요.</p>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <p className="sticky top-0 bg-stone-50/95 backdrop-blur px-4 py-1.5 text-[11px] font-bold text-stone-400 border-b border-stone-100">
                  {fmtDate(g.dateMs)}
                </p>
                {g.items.map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-stone-50">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${KIND_DOT[a.kind] || "bg-stone-300"}`}></span>
                    <p className="flex-1 min-w-0 text-[13px] font-medium text-stone-700 leading-snug">{a.text}</p>
                    <span className="text-[10px] text-stone-400 shrink-0 tabular-nums mt-0.5">{fmtTime(a.at)}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════ 할 일 탭 ═══════════
function TodoTab({ theme, profile, toggleStudent, toggleParent, addTodo, editTodo, deleteTodo, targetDate, setTargetDate, isMaster }) {
  const [text, setText] = useState("");
  const [startH, setStartH] = useState("");
  const [startM, setStartM] = useState("");
  const [dur, setDur] = useState(30);
  const [subject, setSubject] = useState("math");
  const [pts, setPts] = useState(10);

  const time =
    startH === "" ? "" : `${pad2(Math.min(23, parseInt(startH, 10) || 0))}:${pad2(Math.min(59, parseInt(startM || "0", 10) || 0))}`;
  const validDur = Math.max(5, Math.min(600, parseInt(dur, 10) || 0));

  const submit = () => {
    if (!text.trim()) return;
    if (time && (!dur || parseInt(dur, 10) <= 0)) return;
    const ok = addTodo(text.trim(), subject, pts, time, time ? validDur : null);
    if (ok) { setText(""); setStartH(""); setStartM(""); setDur(30); }
  };

  const td = new Date(targetDate);
  const isToday = isSameDay(targetDate, now());
  const targetLabel = `${td.getMonth() + 1}월 ${td.getDate()}일 (${["일","월","화","수","목","금","토"][td.getDay()]})`;
  const targetInputValue = `${td.getFullYear()}-${pad2(td.getMonth() + 1)}-${pad2(td.getDate())}`;

  const byTime = (a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1;
    if (b.time) return 1;
    return b.createdAt - a.createdAt;
  };

  const today = todayStartMs();
  const todayTodos = profile.todos.filter((t) => isSameDay(t.createdAt, today));
  const pending = todayTodos.filter((t) => !t.done && !t.studentDone).sort(byTime);
  const waiting = todayTodos.filter((t) => !t.done && t.studentDone).sort(byTime);
  const done = todayTodos.filter((t) => t.done);

  return (
    <div className="space-y-3.5">
      {/* 등록 날짜 + 추가 폼 통합 */}
      <div className={`${card} p-4 space-y-3.5`}>
        <div className="flex items-center justify-between">
          <SectionLabel accent={theme.bg}>할 일 추가</SectionLabel>
          <label className={`flex items-center gap-1.5 h-8 px-3 rounded-full ${theme.bgSoft} ${theme.textDeep} text-xs font-bold active:scale-95 cursor-pointer`}>
            📅 {targetLabel}{isToday ? " · 오늘" : ""}
            <input
              type="date"
              value={targetInputValue}
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, m, d] = e.target.value.split("-").map(Number);
                setTargetDate(new Date(y, m - 1, d).getTime());
              }}
              className="sr-only"
            />
          </label>
        </div>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="할 일을 입력하세요"
          className={`w-full h-13 py-3 px-4 text-base ${input}`}
        />

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-stone-400 shrink-0 w-12">시작</span>
          <input type="number" min="0" max="23" inputMode="numeric" value={startH} onChange={(e) => setStartH(e.target.value.slice(0, 2))} placeholder="17" className={`w-14 h-11 text-center text-base font-bold ${input}`} />
          <span className="text-xs text-stone-400">시</span>
          <input type="number" min="0" max="59" inputMode="numeric" value={startM} onChange={(e) => setStartM(e.target.value.slice(0, 2))} placeholder="00" className={`w-14 h-11 text-center text-base font-bold ${input}`} />
          <span className="text-xs text-stone-400">분</span>
          {startH !== "" && (
            <button onClick={() => { setStartH(""); setStartM(""); }} className="ml-auto h-11 px-3 rounded-xl bg-stone-100 text-stone-500 text-xs font-bold active:scale-95">지우기</button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-stone-400 shrink-0 w-12">시간</span>
          {[20, 30, 50, 60].map((d) => (
            <button key={d} onClick={() => setDur(d)} className={`h-10 flex-1 rounded-xl text-sm font-bold transition-all active:scale-95 ${
              parseInt(dur, 10) === d ? `${theme.bg} text-white` : "bg-stone-100 text-stone-500"
            }`}>{d}분</button>
          ))}
          <input type="number" min="5" max="600" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value)} className={`w-14 h-10 text-center text-sm font-bold ${input}`} />
        </div>

        {time && (
          <p className={`text-[11px] px-1 font-bold ${theme.text}`}>
            {td.getMonth() + 1}.{td.getDate()} {time} — {addMin(time, validDur)} · {validDur}분
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {SUBJECTS.map((s) => (
            <button key={s.id} onClick={() => setSubject(s.id)} className={`h-9 px-3.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
              subject === s.id ? `${theme.bg} text-white` : `bg-stone-100 ${s.dot}`
            }`}>{s.label}</button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-stone-400 shrink-0 w-12">점수</span>
          {[5, 10, 20].map((p) => (
            <button key={p} onClick={() => setPts(p)} className={`h-10 flex-1 rounded-xl text-sm font-bold transition-all active:scale-95 ${
              pts === p ? `${theme.bg} text-white` : "bg-stone-100 text-stone-500"
            }`}>{p}P</button>
          ))}
        </div>

        <button
          onClick={submit}
          disabled={!text.trim()}
          className={`w-full h-13 py-3.5 rounded-2xl text-white text-sm font-extrabold transition-all active:scale-95 disabled:opacity-30 ${theme.bg}`}
        >
          + {td.getMonth() + 1}.{td.getDate()}에 추가하기
        </button>
      </div>

      {/* 안내: 체크 방식 */}
      <div className={`${theme.bgSoft} rounded-2xl px-4 py-3 flex items-center gap-3`}>
        <div className="flex gap-1.5 shrink-0">
          <span className={`w-8 h-8 rounded-lg ${theme.bg} text-white text-[10px] font-extrabold flex flex-col items-center justify-center leading-none`}>1차<span className="text-[8px] mt-0.5">학생</span></span>
          <span className="w-8 h-8 rounded-lg bg-stone-700 text-white text-[10px] font-extrabold flex flex-col items-center justify-center leading-none">2차<span className="text-[8px] mt-0.5">부모</span></span>
        </div>
        <p className="text-[11px] font-bold text-stone-500 leading-snug">
          학생이 1차 체크 → 부모가 2차 확인하면 포인트가 지급돼요
        </p>
      </div>

      <section className="space-y-2">
        <SectionLabel accent="bg-stone-400">진행 중 · {pending.length}</SectionLabel>
        {pending.length === 0 && <p className="text-stone-400 text-xs py-2">진행 중인 할 일이 없어요.</p>}
        {pending.map((t) => (
          <TodoItem key={t.id} todo={t} theme={theme} onStudent={toggleStudent} onParent={toggleParent} onEdit={editTodo} onDelete={deleteTodo} />
        ))}
      </section>

      {waiting.length > 0 && (
        <section className="space-y-2">
          <SectionLabel accent="bg-amber-400">부모 확인 대기 · {waiting.length}</SectionLabel>
          {waiting.map((t) => (
            <TodoItem key={t.id} todo={t} theme={theme} onStudent={toggleStudent} onParent={toggleParent} onEdit={editTodo} onDelete={deleteTodo} />
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <SectionLabel accent="bg-stone-300">완료 · {done.length}</SectionLabel>
          <div className="bg-stone-100/70 rounded-3xl p-2 space-y-2">
            {done.map((t) => (
              <TodoItem key={t.id} todo={t} theme={theme} onStudent={toggleStudent} onParent={toggleParent} onDelete={deleteTodo} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── 2단계 체크 버튼 (1차 학생 / 2차 부모 표기) ──
function CheckBtn({ topLabel, subLabel, checked, onClick, accentClass }) {
  return (
    <button
      onClick={onClick}
      className={`w-11 h-14 shrink-0 rounded-xl border-2 flex flex-col items-center justify-center transition-all active:scale-90 leading-none ${
        checked ? `${accentClass} border-transparent text-white` : "border-stone-200 bg-white text-stone-300"
      }`}
    >
      {checked ? (
        <span className="text-lg font-bold">✓</span>
      ) : (
        <>
          <span className="text-[11px] font-extrabold">{topLabel}</span>
          <span className="text-[8px] font-bold mt-0.5">{subLabel}</span>
        </>
      )}
    </button>
  );
}

function TodoItem({ todo, theme, onStudent, onParent, onEdit, onDelete, compact }) {
  const [editing, setEditing] = useState(false);
  const [eText, setEText] = useState(todo.text);
  const [eH, setEH] = useState(todo.time ? todo.time.split(":")[0] : "");
  const [eM, setEM] = useState(todo.time ? todo.time.split(":")[1] : "");
  const [eDur, setEDur] = useState(todo.duration || 30);
  const subj = SUBJECTS.find((s) => s.id === todo.subject) || SUBJECTS[5];

  const eTime =
    eH === "" ? "" : `${pad2(Math.min(23, parseInt(eH, 10) || 0))}:${pad2(Math.min(59, parseInt(eM || "0", 10) || 0))}`;

  const resetEdit = () => {
    setEText(todo.text);
    setEH(todo.time ? todo.time.split(":")[0] : "");
    setEM(todo.time ? todo.time.split(":")[1] : "");
    setEDur(todo.duration || 30);
  };

  const saveEdit = () => {
    if (!eText.trim()) return;
    const d = Math.max(5, Math.min(600, parseInt(eDur, 10) || 0));
    const ok = onEdit(todo.id, eText.trim(), eTime, eTime ? d : null);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="bg-white rounded-2xl border-2 border-stone-300 p-3 space-y-2">
        <input value={eText} onChange={(e) => setEText(e.target.value)} className={`w-full h-12 px-3 text-base ${input}`} />
        <div className="flex items-center gap-2 flex-wrap">
          <input type="number" min="0" max="23" inputMode="numeric" value={eH} onChange={(e) => setEH(e.target.value.slice(0, 2))} placeholder="17" className={`w-14 h-11 text-center text-base font-bold ${input}`} />
          <span className="text-sm text-stone-500">시</span>
          <input type="number" min="0" max="59" inputMode="numeric" value={eM} onChange={(e) => setEM(e.target.value.slice(0, 2))} placeholder="00" className={`w-14 h-11 text-center text-base font-bold ${input}`} />
          <span className="text-sm text-stone-500">분</span>
          <input type="number" min="5" max="600" inputMode="numeric" value={eDur} onChange={(e) => setEDur(e.target.value)} className={`w-16 h-11 text-center text-base font-bold ${input}`} />
          <span className="text-sm text-stone-500">분</span>
        </div>
        <div className="flex gap-2">
          <button onClick={saveEdit} className={`flex-1 h-11 rounded-xl text-white text-sm font-extrabold active:scale-95 ${theme.bg}`}>저장</button>
          <button onClick={() => { setEditing(false); resetEdit(); }} className="flex-1 h-11 rounded-xl bg-stone-100 text-stone-500 text-sm font-bold active:scale-95">취소</button>
        </div>
      </div>
    );
  }

  const waiting = todo.studentDone && !todo.done;

  return (
    <div className={`rounded-2xl flex items-center gap-2.5 p-2.5 bg-white ${
      todo.done ? "border border-stone-100" : waiting ? "border-2 border-amber-300" : "border border-stone-100"
    }`}>
      <div className="flex gap-1.5 shrink-0">
        <CheckBtn topLabel="1차" subLabel="학생" checked={todo.studentDone} onClick={() => onStudent(todo.id)} accentClass={theme.bg} />
        <CheckBtn topLabel="2차" subLabel="부모" checked={todo.done} onClick={() => onParent(todo.id)} accentClass="bg-stone-700" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[15px] font-bold leading-snug ${todo.done ? "line-through text-stone-400" : "text-stone-800"}`}>
          {todo.text}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {todo.time && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-500 tabular-nums">
              {todo.time}{todo.duration ? `-${addMin(todo.time, todo.duration)}` : ""}
            </span>
          )}
          <span className={`text-[10px] font-bold ${subj.dot}`}>{subj.label}</span>
          <span className={`text-[10px] font-extrabold ${theme.text}`}>+{todo.pts}P</span>
          {waiting && <span className="text-[10px] font-extrabold text-amber-500">확인대기</span>}
        </div>
      </div>
      {!compact && onEdit && !todo.done && (
        <button onClick={() => setEditing(true)} className="w-8 h-10 shrink-0 rounded-lg text-stone-300 text-sm active:scale-90 active:text-stone-600">✎</button>
      )}
      {!compact && onDelete && (
        <button onClick={() => onDelete(todo.id)} className="w-8 h-10 shrink-0 rounded-lg text-stone-300 text-sm active:scale-90 active:text-red-500">✕</button>
      )}
    </div>
  );
}

// ═══════════ 상점 탭 ═══════════
function ShopTab({ theme, profile, buyReward, addReward, deleteReward, editReward, isMaster, useOwnedReward, undoUsedReward }) {
  const [view, setView] = useState("shop");
  if (view === "history") return <PurchaseHistory theme={theme} profile={profile} onBack={() => setView("shop")} isMaster={isMaster} useOwnedReward={useOwnedReward} undoUsedReward={undoUsedReward} />;
  return <ShopMain theme={theme} profile={profile} buyReward={buyReward} addReward={addReward} deleteReward={deleteReward} editReward={editReward} isMaster={isMaster} onHistory={() => setView("history")} />;
}

function ShopMain({ theme, profile, buyReward, addReward, deleteReward, editReward, isMaster, onHistory }) {
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [eName, setEName] = useState("");
  const [eCost, setECost] = useState("");

  const submit = () => {
    const c = parseInt(cost, 10);
    if (!name.trim() || !c || c <= 0) return;
    if (addReward(name.trim(), c)) { setName(""); setCost(""); setAdding(false); }
  };
  const startEdit = (r) => { setEditingId(r.id); setEName(r.name); setECost(String(r.cost)); };
  const saveEdit = () => {
    const c = parseInt(eCost, 10);
    if (!eName.trim() || !c || c <= 0) return;
    if (editReward(editingId, eName.trim(), c)) { setEditingId(null); setEName(""); setECost(""); }
  };

  return (
    <div className="space-y-3.5">
      {/* 컴팩트 잔액 바 */}
      <div className={`${card} p-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-2xl ${theme.bg} flex items-center justify-center text-white text-lg shrink-0`}>🎁</div>
          <div>
            <p className={label}>보유 포인트</p>
            <p className="text-2xl font-extrabold tabular-nums leading-tight">
              {profile.points}<span className={`text-sm ml-0.5 ${theme.text}`}>P</span>
            </p>
          </div>
        </div>
        <button onClick={onHistory} className="flex items-center gap-1 h-9 px-3.5 rounded-full bg-stone-100 text-stone-600 text-xs font-bold active:scale-95">
          교환 내역 <ArrowRightIcon />
        </button>
      </div>

      {/* 보상 목록 */}
      <section className="space-y-2">
        <SectionLabel accent={theme.bg}>보상 목록 · {profile.rewards.length}</SectionLabel>
        {profile.rewards.map((r) => {
          const affordable = profile.points >= r.cost;
          const confirming = confirmId === r.id;
          const isEditing = editingId === r.id;

          if (isEditing) {
            return (
              <div key={r.id} className="bg-white rounded-2xl border-2 border-stone-300 p-3 space-y-2">
                <input value={eName} onChange={(e) => setEName(e.target.value)} className={`w-full h-11 px-3 text-base ${input}`} placeholder="보상 이름" />
                <div className="flex items-center gap-2">
                  <input value={eCost} onChange={(e) => setECost(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={`flex-1 h-11 px-3 text-center text-base font-bold ${input}`} placeholder="포인트" />
                  <button onClick={saveEdit} className={`h-11 px-4 rounded-xl text-white text-sm font-extrabold active:scale-95 ${theme.bg}`}>저장</button>
                  <button onClick={() => { setEditingId(null); }} className="h-11 px-3 rounded-xl bg-stone-100 text-stone-500 text-sm font-bold active:scale-95">취소</button>
                </div>
              </div>
            );
          }

          return (
            <div key={r.id} className={`${card} p-3.5 flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-stone-800">{r.name}</p>
                <p className={`text-base font-extrabold mt-0.5 ${theme.text} tabular-nums`}>{r.cost}P</p>
              </div>
              {confirming ? (
                <div className="flex gap-2">
                  <button onClick={() => { buyReward(r); setConfirmId(null); }} className={`h-11 px-4 rounded-xl text-white text-sm font-extrabold active:scale-95 ${theme.bg}`}>확인</button>
                  <button onClick={() => setConfirmId(null)} className="h-11 px-3 rounded-xl bg-stone-100 text-stone-500 text-sm font-bold active:scale-95">취소</button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => { if (affordable) setConfirmId(r.id); else buyReward(r); }}
                    className={`h-11 px-5 rounded-xl text-sm font-extrabold transition-all active:scale-95 ${
                      affordable ? `${theme.bg} text-white` : "bg-stone-100 text-stone-400"
                    }`}
                  >교환</button>
                  {isMaster && (
                    <>
                      <button onClick={() => startEdit(r)} className="w-8 h-11 text-stone-400 active:text-stone-700 text-sm">✎</button>
                      <button onClick={() => deleteReward(r.id)} className="w-8 h-11 text-stone-400 active:text-red-500 text-sm">✕</button>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </section>

      {isMaster ? (
        adding ? (
          <div className={`${card} p-4 space-y-3`}>
            <SectionLabel accent="bg-amber-400">새 보상 (부모)</SectionLabel>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="보상 이름 (예: 치킨 파티)" className={`w-full h-12 px-4 text-base ${input}`} />
            <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9]/g, ""))} placeholder="필요 포인트 (예: 150)" inputMode="numeric" className={`w-full h-12 px-4 text-base ${input}`} />
            <div className="flex gap-2">
              <button onClick={submit} className={`flex-1 h-12 rounded-2xl text-white font-extrabold active:scale-95 ${theme.bg}`}>추가</button>
              <button onClick={() => setAdding(false)} className="flex-1 h-12 rounded-2xl bg-stone-100 text-stone-500 font-bold active:scale-95">취소</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="w-full h-12 rounded-2xl border border-dashed border-stone-300 text-stone-500 font-bold active:scale-95 bg-white text-sm">
            + 새 보상 추가 (부모)
          </button>
        )
      ) : (
        <p className="text-[11px] text-stone-400 text-center py-1">보상 추가·수정은 부모(관리자)만 가능해요</p>
      )}
    </div>
  );
}

// ═══════════ 교환 내역 ═══════════
function PurchaseHistory({ theme, profile, onBack, isMaster, useOwnedReward, undoUsedReward }) {
  const purchases = profile.purchases || [];
  const usedRewards = profile.usedRewards || {};
  const total = purchases.reduce((s, p) => s + p.cost, 0);

  // 보유 교환권: 이름별로 (구매 개수 − 사용 개수) 집계
  const inventory = useMemo(() => {
    const map = {};
    purchases.forEach((p) => {
      if (!map[p.name]) map[p.name] = { name: p.name, bought: 0, lastAt: p.at, cost: p.cost };
      map[p.name].bought += 1;
      if (p.at > map[p.name].lastAt) map[p.name].lastAt = p.at;
    });
    return Object.values(map)
      .map((it) => {
        const used = usedRewards[it.name] || 0;
        return { ...it, used, remaining: Math.max(0, it.bought - used) };
      })
      .sort((a, b) => b.lastAt - a.lastAt);
  }, [purchases, usedRewards]);

  const ownedList = inventory.filter((it) => it.remaining > 0);

  const groups = useMemo(() => {
    const g = [];
    purchases.forEach((p) => {
      const d = new Date(p.at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
      const last = g[g.length - 1];
      if (last && last.key === key) last.items.push(p);
      else g.push({ key, label, items: [p] });
    });
    return g;
  }, [purchases]);

  return (
    <div className="space-y-3.5">
      <button onClick={onBack} className="flex items-center gap-2 text-xs font-bold text-stone-500 active:text-stone-900 active:scale-95 py-1">
        <ArrowLeftIcon /> 상점으로
      </button>

      <div className={`${card} p-4 flex items-center justify-between`}>
        <div>
          <p className={label}>교환 내역</p>
          <p className="text-sm font-bold text-stone-700 mt-1">총 {purchases.length}건 교환</p>
        </div>
        <div className="text-right">
          <p className={label}>사용 포인트</p>
          <p className={`text-2xl font-extrabold ${theme.text} tabular-nums leading-tight`}>{total}P</p>
        </div>
      </div>

      {/* ── 보유 교환권 ── */}
      <section className="space-y-2">
        <SectionLabel accent={theme.bg} right={<span className={`text-[11px] font-bold ${theme.text} tabular-nums`}>{ownedList.reduce((s, it) => s + it.remaining, 0)}개 보유</span>}>
          보유 교환권
        </SectionLabel>
        {ownedList.length === 0 ? (
          <div className={`${card} p-6 text-center`}>
            <p className="text-sm text-stone-400">사용 가능한 교환권이 없어요</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ownedList.map((it) => (
              <div key={it.name} className={`${card} p-3.5 flex items-center gap-3`}>
                <div className={`w-10 h-10 rounded-xl ${theme.bgSoft} ${theme.text} flex items-center justify-center text-base shrink-0`}>🎫</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-extrabold text-stone-800 truncate">
                    {it.name} <span className={theme.text}>× {it.remaining}개</span>
                  </p>
                  <p className="text-[11px] text-stone-400 mt-0.5 tabular-nums">
                    누적 {it.bought}개 교환{it.used > 0 ? ` · ${it.used}개 사용` : ""}
                  </p>
                </div>
                {isMaster ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => useOwnedReward(it.name)}
                      className={`h-9 px-3 rounded-xl ${theme.bg} text-white text-xs font-extrabold active:scale-95`}
                    >
                      1개 사용
                    </button>
                  </div>
                ) : (
                  <span className={`shrink-0 text-lg font-extrabold ${theme.text} tabular-nums`}>{it.remaining}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {isMaster && (
          <p className="text-[10px] text-stone-400 px-1 leading-relaxed">
            "1개 사용"을 누르면 보유 개수가 하나 줄어요. 실수했다면 아래 "사용한 교환권"에서 되돌릴 수 있어요.
          </p>
        )}
      </section>

      {/* ── 사용한 교환권 (관리자만, 되돌리기 가능) ── */}
      {isMaster && inventory.some((it) => it.used > 0) && (
        <section className="space-y-2">
          <SectionLabel accent="bg-stone-400">사용한 교환권</SectionLabel>
          <div className={`${card} divide-y divide-stone-100`}>
            {inventory.filter((it) => it.used > 0).map((it) => (
              <div key={it.name} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-stone-700 truncate">{it.name}</p>
                  <p className="text-[11px] text-stone-400 mt-0.5 tabular-nums">{it.used}개 사용 · {it.remaining}개 남음</p>
                </div>
                <button
                  onClick={() => undoUsedReward(it.name)}
                  className="h-9 px-3 rounded-xl bg-stone-100 text-stone-600 text-xs font-bold active:scale-95 shrink-0"
                >
                  1개 되돌리기
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 교환 기록 (월별) ── */}
      {purchases.length === 0 ? (
        <div className={`${card} p-10 text-center`}>
          <p className="text-3xl mb-2 opacity-20">🎁</p>
          <p className="text-sm font-bold text-stone-500">아직 교환 내역이 없어요</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="space-y-2">
            <SectionLabel accent={theme.bg} right={<span className={`text-[11px] font-bold ${theme.text} tabular-nums`}>{g.items.length}건 · {g.items.reduce((s, p) => s + p.cost, 0)}P</span>}>
              {g.label}
            </SectionLabel>
            <div className={`${card} divide-y divide-stone-100`}>
              {g.items.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-stone-800">{p.name}</p>
                    <p className="text-[11px] text-stone-400 mt-0.5 tabular-nums">
                      {new Date(p.at).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })} {fmtTime(p.at)}
                    </p>
                  </div>
                  <p className="text-base font-extrabold text-stone-600 tabular-nums">-{p.cost}P</p>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

// ═══════════ 통계 탭 ═══════════
function DashTab({ theme, profile }) {
  const [range, setRange] = useState("week");
  const todayStr = new Date().toISOString().slice(0, 10);
  const [customStart, setCustomStart] = useState(todayStr);
  const [customEnd, setCustomEnd] = useState(todayStr);

  const { start, end, label: rangeLabel } = useMemo(() => {
    if (range === "week") return { start: startOfWeek(), end: now() + 1, label: "이번 주" };
    if (range === "month") return { start: startOfMonth(), end: now() + 1, label: "이번 달" };
    const s = new Date(customStart + "T00:00:00").getTime();
    const e = new Date(customEnd + "T00:00:00").getTime() + 86400000;
    return { start: s, end: e, label: "지정 기간" };
  }, [range, customStart, customEnd]);

  const stats = useMemo(() => computeStats(profile, start, end), [profile, start, end]);
  const timerStats = useMemo(() => computeTimerStats(profile, start, end), [profile, start, end]);

  const barData = useMemo(() => {
    if (range === "week") {
      const ws = startOfWeek();
      return DAY_LABELS.map((label, i) => {
        const ds = ws + i * 86400000;
        return {
          label,
          done: profile.todos.filter((t) => t.done && t.doneAt >= ds && t.doneAt < ds + 86400000).length,
          minutes: (profile.timerLogs || []).filter((l) => l.at >= ds && l.at < ds + 86400000).reduce((sum, l) => sum + l.minutes, 0),
        };
      });
    }
    if (range === "month") {
      const ms = startOfMonth();
      const weeks = Math.ceil(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() / 7);
      return Array.from({ length: weeks }, (_, i) => {
        const ds = ms + i * 7 * 86400000;
        return {
          label: `${i + 1}주`,
          done: profile.todos.filter((t) => t.done && t.doneAt >= ds && t.doneAt < ds + 7 * 86400000).length,
          minutes: (profile.timerLogs || []).filter((l) => l.at >= ds && l.at < ds + 7 * 86400000).reduce((sum, l) => sum + l.minutes, 0),
        };
      });
    }
    return null;
  }, [range, profile]);

  const R = 50;
  const CIRC = 2 * Math.PI * R;
  const invalidRange = range === "custom" && start >= end;

  return (
    <div className="space-y-3.5">
      <div className={`${card} p-1.5 flex gap-1`}>
        {[{ id: "week", label: "주간" }, { id: "month", label: "월간" }, { id: "custom", label: "기간" }].map((r) => (
          <button key={r.id} onClick={() => setRange(r.id)} className={`flex-1 h-10 rounded-full text-xs font-bold transition-all active:scale-95 ${
            range === r.id ? `${theme.bg} text-white` : "text-stone-500"
          }`}>{r.label}</button>
        ))}
      </div>

      {range === "custom" && (
        <div className={`${card} p-3 space-y-2`}>
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} className={`flex-1 h-11 px-3 text-sm ${input}`} />
            <span className="text-stone-400 font-bold">-</span>
            <input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} className={`flex-1 h-11 px-3 text-sm ${input}`} />
          </div>
          {invalidRange && <p className="text-xs text-red-500 px-1">종료일이 시작일보다 빠를 수 없어요.</p>}
        </div>
      )}

      {/* 공부시간 + 달성률 요약 (2열) */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`${card} p-4`}>
          <p className={label}>총 공부시간</p>
          <p className={`text-2xl font-extrabold ${theme.text} tabular-nums mt-1 leading-tight`}>{fmtDur(timerStats.total)}</p>
          <p className="text-[11px] text-stone-400 mt-1 font-bold">타이머 {timerStats.count}회</p>
        </div>
        <div className={`${card} p-4 flex items-center gap-3`}>
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r={R} fill="none" stroke="#f5f5f4" strokeWidth="10" />
              <circle cx="60" cy="60" r={R} fill="none" stroke={theme.ring} strokeWidth="10" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - stats.rate / 100)} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-base font-extrabold tabular-nums">{stats.rate}%</span>
            </div>
          </div>
          <div>
            <p className={label}>달성률</p>
            <p className="text-sm font-bold text-stone-600 mt-1 tabular-nums">{stats.done}/{stats.total}건</p>
            <p className={`text-[11px] font-extrabold ${theme.text} tabular-nums`}>{stats.pts}P 획득</p>
          </div>
        </div>
      </div>

      {/* 과목별 공부시간 */}
      {timerStats.bySubject.length > 0 && (
        <div className={`${card} p-4 space-y-2`}>
          <SectionLabel accent={theme.bg}>과목별 공부시간</SectionLabel>
          <div className="space-y-1.5 pt-1">
            {timerStats.bySubject.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className={`font-bold ${s.dot}`}>● {s.label}</span>
                <span className="font-extrabold text-stone-600 tabular-nums">{fmtDur(s.minutes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {barData && (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel accent={theme.bg}>{range === "week" ? "요일별" : "주차별"}</SectionLabel>
            <div className="flex items-center gap-2.5 text-[10px] font-bold">
              <span className={`inline-flex items-center gap-1 ${theme.text}`}><span className={`w-2 h-2 rounded-sm ${theme.bg}`}></span>승인</span>
              <span className="inline-flex items-center gap-1 text-amber-500"><span className="w-2 h-2 rounded-sm bg-amber-400"></span>공부</span>
            </div>
          </div>
          <div className="flex items-end justify-between gap-1.5 h-28">
            {barData.map((d, i) => {
              const maxDone = Math.max(...barData.map((x) => x.done), 1);
              const maxMin = Math.max(...barData.map((x) => x.minutes), 1);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <div className="flex gap-0.5 items-end w-full h-full justify-center">
                    <div className={`w-1/3 rounded-t ${d.done > 0 ? theme.bg : "bg-stone-100"} transition-all duration-500`} style={{ height: `${Math.max((d.done / maxDone) * 80, 4)}%` }} />
                    <div className={`w-1/3 rounded-t ${d.minutes > 0 ? "bg-amber-400" : "bg-stone-100"} transition-all duration-500`} style={{ height: `${Math.max((d.minutes / maxMin) * 80, 4)}%` }} />
                  </div>
                  <span className="text-[10px] text-stone-400 font-bold">{d.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={`${card} p-4 space-y-3`}>
        <SectionLabel accent={theme.bg}>과목별 달성률</SectionLabel>
        {stats.bySubject.length === 0 && <p className="text-sm text-stone-400">{rangeLabel}에 등록된 할 일이 없어요.</p>}
        {stats.bySubject.map((s) => (
          <div key={s.id}>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-bold ${s.dot}`}>● {s.label}</span>
              <span className="text-xs font-bold text-stone-500 tabular-nums">{s.done}/{s.total} · {s.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
              <div className={`h-full rounded-full ${theme.bg} transition-all duration-500`} style={{ width: `${s.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════ 위치 보기 (마스터 전용) ═══════════
function LocationView({ locations }) {
  const [selected, setSelected] = useState(null);
  const entries = Object.entries(THEMES)
    .map(([key, t]) => ({ key, theme: t, loc: locations[key] }))
    .filter((e) => e.loc);

  const relTime = (ms) => {
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60) return "방금 전";
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  };

  const active = selected
    ? entries.find((e) => e.key === selected) || entries[0]
    : entries[0];

  // 마커가 있는 OpenStreetMap 임베드 URL (키 불필요)
  const embedUrl = (loc) => {
    const d = 0.008;
    const bbox = `${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
  };
  const kakaoUrl = (loc) => `https://map.kakao.com/link/map/${encodeURIComponent(active.theme.realName)},${loc.lat},${loc.lng}`;

  if (entries.length === 0) {
    return (
      <div className={`${card} p-10 text-center space-y-3`}>
        <p className="text-3xl opacity-30">📍</p>
        <p className="text-sm font-bold text-stone-500">공유된 위치가 없어요</p>
        <p className="text-xs text-stone-400 leading-relaxed">
          아이가 자기 홈 화면에서 "부모님께 내 위치 공유"를<br />켜면 여기에 지도로 표시돼요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 아이 선택 칩 */}
      <div className={`${card} p-1.5 flex gap-1`}>
        {entries.map((e) => {
          const on = active.key === e.key;
          return (
            <button key={e.key} onClick={() => setSelected(e.key)} className={`flex-1 h-10 rounded-full text-xs font-bold transition-all active:scale-95 ${
              on ? `${e.theme.bg} text-white` : "text-stone-500"
            }`}>{e.theme.realName}</button>
          );
        })}
      </div>

      {/* 지도 */}
      <div className={`${card} overflow-hidden`}>
        <div className="w-full h-64 bg-stone-100">
          <iframe
            key={active.key}
            title="지도"
            className="w-full h-full border-0"
            src={embedUrl(active.loc)}
            loading="lazy"
          />
        </div>
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${active.theme.bg}`}></span>
              <p className="text-base font-extrabold text-stone-800">{active.theme.realName}</p>
            </div>
            <span className="text-[11px] font-bold text-stone-400">{relTime(active.loc.at)} 갱신</span>
          </div>
          <p className="text-xs text-stone-500 tabular-nums">
            좌표 {active.loc.lat.toFixed(5)}, {active.loc.lng.toFixed(5)}
            {active.loc.acc ? ` · 오차 약 ${active.loc.acc}m` : ""}
          </p>
          <p className="text-[11px] text-stone-400">
            마지막 확인: {fmtDate(active.loc.at)} {fmtTime(active.loc.at)}
          </p>
          <a
            href={kakaoUrl(active.loc)}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full h-11 rounded-2xl bg-stone-800 text-white text-sm font-extrabold flex items-center justify-center active:scale-95 mt-1"
          >
            큰 지도(카카오맵)로 열기
          </a>
        </div>
      </div>

      {/* 전체 목록 */}
      <section className="space-y-2">
        <SectionLabel accent="bg-stone-400">공유 중 · {entries.length}명</SectionLabel>
        {entries.map((e) => (
          <button key={e.key} onClick={() => setSelected(e.key)} className={`${card} w-full p-3.5 flex items-center gap-3 active:scale-[0.99] transition-transform`}>
            <div className={`w-9 h-9 rounded-xl ${e.theme.bg} flex items-center justify-center text-white text-sm font-extrabold shrink-0`}>
              {e.theme.realName[0]}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-bold text-stone-800">{e.theme.realName}</p>
              <p className="text-[11px] text-stone-400 tabular-nums">{relTime(e.loc.at)} · 오차 약 {e.loc.acc}m</p>
            </div>
            <span className="text-stone-300 shrink-0"><ArrowRightIcon /></span>
          </button>
        ))}
      </section>

      <p className="text-[10px] text-stone-400 text-center leading-relaxed px-3 pt-1">
        위치는 아이가 직접 공유를 켠 경우에만, 그 기기의 GPS로 표시돼요.<br />
        앱이 열려 있을 때 2분마다 갱신되며, 정확도는 기기·환경에 따라 달라질 수 있어요.
      </p>
    </div>
  );
}

// ═══════════ 관리자 탭 ═══════════
function AdminTab({ data, isMaster, resetUserPw, locations }) {
  const [view, setView] = useState("log");
  const [filter, setFilter] = useState("all");
  const [confirmReset, setConfirmReset] = useState(null);

  if (!isMaster) {
    return (
      <div className={`${card} p-10 text-center space-y-3 mt-6`}>
        <div className="w-14 h-14 mx-auto rounded-2xl bg-stone-100 flex items-center justify-center text-stone-400"><LockIcon /></div>
        <div>
          <h2 className="text-xl font-extrabold text-stone-800">부모(관리자) 전용</h2>
          <p className="text-sm text-stone-500 mt-2 leading-relaxed">관리자 계정으로 로그인해야<br />볼 수 있어요</p>
        </div>
      </div>
    );
  }

  const ACTION_STYLE = {
    "추가": "text-sky-500", "수정": "text-amber-500",
    "1차 완료": "text-teal-500", "1차 취소": "text-orange-500",
    "2차 승인": "text-emerald-500", "2차 승인 취소": "text-orange-500",
    "삭제": "text-red-500",
    "보상 추가": "text-violet-500", "보상 삭제": "text-red-500", "보상 교환": "text-pink-500", "보상 수정": "text-amber-500",
    "보상 사용": "text-teal-500", "보상 사용 취소": "text-orange-500",
    "회원가입": "text-sky-500", "비번 초기화": "text-amber-500",
    "타이머 기록": "text-emerald-500",
  };

  const filtered = data.history.filter((h) => filter === "all" || h.kidKey === filter);
  const groups = [];
  filtered.forEach((h) => {
    const key = new Date(h.at).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(h);
    else groups.push({ key, dateMs: h.at, items: [h] });
  });

  const lastLogin = (name) => {
    const l = data.loginLogs.find((x) => x.name === name && x.ok);
    return l ? fmtDateTime(l.at) : "기록 없음";
  };

  return (
    <div className="space-y-3.5">
      <div className={`${card} p-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-400 flex items-center justify-center text-white"><LockIcon /></div>
          <div>
            <p className={label}>관리자</p>
            <p className="text-base font-extrabold text-stone-800">부모 콘솔</p>
          </div>
        </div>
      </div>

      <div className={`${card} p-1.5 flex gap-1`}>
        {[{ id: "log", label: "변경 이력" }, { id: "members", label: "회원 관리" }, { id: "location", label: "위치" }].map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} className={`flex-1 h-10 rounded-full text-xs font-bold transition-all active:scale-95 ${
            view === v.id ? "bg-stone-800 text-white" : "text-stone-500"
          }`}>{v.label}</button>
        ))}
      </div>

      {view === "location" ? (
        <LocationView locations={locations} />
      ) : view === "members" ? (
        <>
          <section className="space-y-2">
            <SectionLabel accent="bg-amber-400">회원 · {data.users.length}명</SectionLabel>
            {data.users.map((u) => (
              <div key={u.name} className={`${card} p-4 space-y-2.5`}>
                <div className="flex items-center gap-2">
                  <p className="text-base font-extrabold text-stone-800">{u.name}</p>
                  {u.role === "master" ? (
                    <span className="text-[9px] font-extrabold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">부모</span>
                  ) : (
                    <span className="text-[9px] font-extrabold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">학생</span>
                  )}
                </div>
                <p className="text-[11px] text-stone-500 tabular-nums">
                  가입 {new Date(u.createdAt).toLocaleDateString("ko-KR")} · 최근 {lastLogin(u.name)}
                </p>
                {u.role !== "master" && (
                  confirmReset === u.name ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-amber-600 flex-1">비밀번호를 {RESET_PW}으로 초기화할까요?</p>
                      <button onClick={() => { resetUserPw(u.name); setConfirmReset(null); }} className="h-10 px-3 rounded-xl bg-stone-800 text-white text-xs font-extrabold active:scale-95">확인</button>
                      <button onClick={() => setConfirmReset(null)} className="h-10 px-3 rounded-xl bg-stone-100 text-stone-500 text-xs font-bold active:scale-95">취소</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmReset(u.name)} className="w-full h-10 rounded-xl bg-stone-100 text-stone-700 text-xs font-bold active:scale-95">
                      비번 초기화
                    </button>
                  )
                )}
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <SectionLabel accent="bg-stone-400">로그인 기록</SectionLabel>
            {data.loginLogs.length === 0 ? (
              <div className={`${card} p-6 text-center`}><p className="text-sm text-stone-400">아직 로그인 기록이 없어요.</p></div>
            ) : (
              <div className={`${card} divide-y divide-stone-100`}>
                {data.loginLogs.slice(0, 15).map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-4 py-3">
                    <p className="text-sm font-bold text-stone-700">{l.name}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-stone-400 tabular-nums">{fmtDateTime(l.at)}</span>
                      <span className={`text-[10px] font-extrabold ${l.ok ? "text-emerald-500" : "text-red-500"}`}>{l.ok ? "성공" : "실패"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div className={`${card} p-1.5 flex gap-1`}>
            {[
              { id: "all", label: "전체" },
              { id: "first", label: THEMES.first.realName },
              { id: "second", label: THEMES.second.realName },
              { id: "third", label: THEMES.third.realName },
            ].map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`flex-1 h-10 rounded-full text-[11px] font-bold transition-all active:scale-95 ${
                filter === f.id ? "bg-stone-800 text-white" : "text-stone-500"
              }`}>{f.label}</button>
            ))}
          </div>

          {groups.length === 0 ? (
            <div className={`${card} p-10 text-center`}><p className="text-sm text-stone-400">아직 기록된 이력이 없어요.</p></div>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="space-y-2">
                <SectionLabel accent={THEMES[filter]?.bg || "bg-stone-400"}>{fmtDate(g.dateMs)}</SectionLabel>
                <div className={`${card} divide-y divide-stone-100`}>
                  {g.items.map((h) => {
                    const t = THEMES[h.kidKey];
                    return (
                      <div key={h.id} className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-extrabold ${ACTION_STYLE[h.action] || "text-stone-500"}`}>{h.action}</span>
                          <span className="text-xs font-bold text-stone-700">{h.actor}</span>
                          {t && <span className={`text-[11px] font-bold ${t.text}`}>→ {t.realName}</span>}
                          <span className="text-[10px] text-stone-400 ml-auto tabular-nums">{fmtTime(h.at)}</span>
                        </div>
                        <p className="text-[13px] text-stone-600 mt-1 leading-snug break-all">{h.detail}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
