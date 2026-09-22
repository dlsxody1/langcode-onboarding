# 스트리밍 UI 렌더링

**이미 잘하는 영역이다.** 입원 차트에서 표 전체가 재렌더되던 걸 Profiler 로 찾아 행 단위로 줄인 경험이
여기에 그대로 적용된다. 채팅 화면 특유의 함정만 추가로 짚는다.

---

## 1. 문제의 구조

LLM 은 초당 수십 토큰을 뱉는다. 토큰마다 `setState` 하면 **초당 수십 번 리렌더**다.

```tsx
// ❌ 모든 토큰마다 전체 대화 목록이 리렌더된다
const [messages, setMessages] = useState<Message[]>([]);

onToken((t) => setMessages(prev => {
  const last = prev[prev.length - 1];
  return [...prev.slice(0, -1), { ...last, content: last.content + t }];
}));
```

`messages` 배열이 통째로 새로 만들어지므로 **이전 메시지 100개도 전부 리렌더** 대상이 된다.
게다가 마크다운 파서가 매 토큰마다 전체 텍스트를 다시 파싱한다.

---

## 2. 해법 — 세 겹으로

### ① 스트리밍 중인 메시지를 분리한다

```tsx
// 확정된 메시지 목록 — 스트리밍 중에는 절대 안 바뀐다
const [messages, setMessages] = useState<Message[]>([]);
// 지금 오고 있는 것만 별도 상태
const [streaming, setStreaming] = useState<string>("");

// 끝나면 한 번만 합친다
onDone(() => {
  setMessages(prev => [...prev, { role: "assistant", content: streaming }]);
  setStreaming("");
});
```

**이것만으로 리렌더 범위가 "마지막 버블 하나"로 줄어든다.** 가장 효과가 크고 가장 쉽다.

### ② 토큰을 ref 에 모으고 간헐적으로 커밋

```tsx
const bufferRef = useRef("");
const [text, setText] = useState("");

useEffect(() => {
  let raf = 0;
  const flush = () => {
    setText(bufferRef.current);      // 프레임당 최대 1회
    raf = requestAnimationFrame(flush);
  };
  raf = requestAnimationFrame(flush);
  return () => cancelAnimationFrame(raf);
}, []);

onToken((t) => { bufferRef.current += t; });   // 렌더 유발 없음
```

초당 60회 이상으로는 어차피 사람이 인지하지 못한다. `requestAnimationFrame` 이나
50~100ms throttle 로 커밋 빈도를 고정한다.

> 입원 차트에서 한 것과 같은 발상이다. **"데이터 갱신 빈도"와 "렌더 빈도"를 분리한다.**

### ③ 확정 메시지를 memo 로 잠근다

```tsx
const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  return <Markdown>{message.content}</Markdown>;
}, (a, b) => a.message.id === b.message.id && a.message.content === b.message.content);
```

리스트 key 는 반드시 안정적인 id 로. 인덱스를 쓰면 스트리밍 중 재정렬에서 깨진다.

---

## 3. 마크다운 — 채팅 UI 최대의 성능 함정

```tsx
<Markdown>{streamingText}</Markdown>    // ❌ 토큰마다 전체 재파싱 + 전체 DOM 교체
```

문제가 두 겹이다.
1. 파싱 비용이 텍스트 길이에 비례해 누적된다 (O(n²))
2. **미완성 마크다운이 깨진 채로 렌더된다** — 닫히지 않은 코드블록, ` ** ` 하나만 온 상태

### 대응

| 방법 | 설명 |
| --- | --- |
| **블록 단위 분할 + memo** | 완성된 블록(문단·코드블록)은 더 이상 안 바뀌므로 memo. 마지막 블록만 다시 렌더 |
| **스트리밍 중엔 plain text** | 끝나면 한 번 마크다운으로 교체. 가장 단순하고 확실하다 |
| **미완성 보정** | 닫히지 않은 코드 펜스를 임시로 닫아서 파서에 넘긴다 |
| **코드 하이라이팅 지연** | Shiki/Prism 은 무겁다. 스트리밍 중엔 끄고 완료 후 적용 |

**실무에서는 "마지막 블록만 raw, 나머지는 memo 된 마크다운"** 조합이 가장 많이 쓰인다.

```tsx
// 완성된 블록들 (변하지 않음) + 진행 중인 마지막 블록
const blocks = useMemo(() => splitIntoBlocks(text), [text]);
return (
  <>
    {blocks.slice(0, -1).map(b => <MemoBlock key={b.id} block={b} />)}
    <pre className="whitespace-pre-wrap">{blocks.at(-1)?.raw}</pre>
  </>
);
```

---

## 4. 자동 스크롤 — 생각보다 까다롭다

```tsx
// ❌ 사용자가 위로 올려 읽고 있는데 계속 끌어내린다
useEffect(() => { endRef.current?.scrollIntoView(); }, [text]);
```

**규칙: 사용자가 바닥 근처에 있을 때만 따라간다.**

```tsx
const [stick, setStick] = useState(true);

const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
  const el = e.currentTarget;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  setStick(atBottom);
};

useEffect(() => {
  if (stick) endRef.current?.scrollIntoView({ behavior: "auto" });
}, [text, stick]);
```

추가로:
- **"맨 아래로" 버튼**을 `stick === false` 일 때 띄운다
- `behavior: "smooth"` 는 스트리밍 중엔 쓰지 마라. 애니메이션이 밀려 끊겨 보인다
- **CSS 로 해결하는 법:** 컨테이너에 `overflow-anchor: auto` + `display: flex; flex-direction: column-reverse`
  조합을 쓰면 브라우저가 알아서 바닥에 고정한다. 다만 스크롤 방향 로직이 뒤집혀 다루기 까다롭다

---

## 5. 취소

```tsx
const abortRef = useRef<AbortController | null>(null);

const send = async (msg: string) => {
  abortRef.current = new AbortController();
  await streamChat(msg, { signal: abortRef.current.signal, onToken });
};

const stop = () => {
  abortRef.current?.abort();            // ① 클라이언트 연결 끊기
  fetch(`/api/chat/runs/${runId}`, { method: "DELETE" });   // ② 서버에도 알림
};
```

**①만 하면 서버는 계속 돌면서 토큰 비용을 태운다.** 둘 다 필요하다.
서버 쪽에서는 `CancellationToken` 이 LLM 호출까지 전파돼 있어야 실제로 멈춘다.

취소했을 때 **이미 받은 부분 응답은 남긴다.** 지워버리면 사용자가 읽던 내용이 사라진다.

---

## 6. 채팅 + 업무 화면 연계 — 공고에 적힌 그 업무

> "AI Agent 등의 채팅 중심 화면 요소와 업무 중심 화면 요소간 연계"

### 무엇이 어려운가

에이전트가 업무 데이터를 **바꾸면**, 옆에 열려 있는 업무 화면이 낡은 데이터를 보여주게 된다.

```
[좌] 채팅: "이 견적서 승인해줘"  → 에이전트가 상태를 변경
[우] 견적서 목록: 아직 '대기중'으로 표시
```

### 대응

| 방법 | 설명 |
| --- | --- |
| **이벤트 기반 무효화** | 에이전트 완료 시 `{ type: "entity_changed", entity: "quote", id }` 이벤트를 SSE 로 → `queryClient.invalidateQueries(['quote', id])` |
| **낙관적 반영** | 에이전트가 "무엇을 할 것인지"를 먼저 알려주면 UI 를 미리 갱신. 실패 시 롤백 |
| **단일 진실 원천** | 채팅이 만든 변경도 결국 같은 API 를 타게 한다. 채팅 전용 경로를 만들면 두 상태가 갈라진다 |
| **승인 UI** | 부작용 있는 행동은 채팅 안에 인라인 카드로 띄우고 사용자가 확인 |

**세 번째가 설계의 핵심이다.** 에이전트가 DB 를 직접 만지는 경로를 따로 두면,
업무 화면의 검증·감사 로그·권한 체크를 전부 우회하게 된다.
**에이전트도 우리 API 의 클라이언트여야 한다.**

> TanStack Query 를 쓰고 있다면 `invalidateQueries` 로 대부분 해결된다.
> **어려운 건 기술이 아니라 "무엇이 바뀌었는지 서버가 알려주게 만드는 것"** 이다.

---

## 7. 그 밖에 챙길 것

| 항목 | |
| --- | --- |
| **접근성** | 스트리밍 텍스트에 `aria-live="polite"` — 단, 토큰마다 읽으면 소음이 된다. 완료 시에만 알리는 게 낫다 |
| **긴 대화** | 메시지 수백 개면 가상 스크롤(react-virtual). 단, 높이가 가변이라 까다롭다 |
| **에러 중간 발생** | 스트림 도중 끊기면 부분 응답 + "재시도" 버튼. 통째로 날리지 않는다 |
| **새로고침 복구** | `runId` 를 URL 이나 localStorage 에. 진행 중 작업을 잃지 않게 |
| **동시 대화** | 여러 탭에서 같은 대화를 열면? BroadcastChannel 또는 서버 상태를 진실로 |
| **비용 표시** | 내부 도구라면 토큰 사용량을 보여주는 것도 유용하다 |

---

## 8. 측정

추측하지 말고 React DevTools Profiler 로 확인한다.

```
1. Profiler 녹화 시작
2. 스트리밍 응답 하나 받기
3. 커밋 횟수와 각 커밋의 소요 시간 확인
```

- 커밋이 수백 번 → ② throttle 이 안 걸린 것
- 커밋당 시간이 길다 → 렌더 범위가 넓은 것 (① 분리, ③ memo)
- 특정 컴포넌트만 오래 → 대개 마크다운/하이라이터

**이미 해본 방법 그대로다.** 대상이 입원 차트에서 채팅 버블로 바뀐 것뿐이다.
