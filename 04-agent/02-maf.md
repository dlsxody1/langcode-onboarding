# MAF (Microsoft Agent Framework)

> ⚠️ **이 문서는 공개 자료 기반이고 실물로 검증하지 않았다.** 프레임워크 API 는 빠르게 바뀐다.
> **개념 부분만 신뢰하고, 코드 모양은 입사 후 공식 문서와 사내 코드로 대조해라.**
> 공식 문서: https://learn.microsoft.com/agent-framework · https://github.com/microsoft/agent-framework

---

## 1. 무엇인가

마이크로소프트가 기존 두 프로젝트를 합쳐 만든 에이전트 프레임워크다.

```
Semantic Kernel  (엔터프라이즈용, 안정적, 단일 에이전트 + 플러그인 중심)
        +
AutoGen          (연구용, 멀티 에이전트 대화·협업 중심)
        ↓
Microsoft Agent Framework (MAF)
```

- **.NET 과 Python 양쪽 SDK** 제공 ← 랭코드 스택(C# + Python)과 정확히 맞는다
- Azure AI Foundry / Azure OpenAI 와 통합
- **왜 랭코드가 이걸 쓰나:** MS 파트너 + Azure 중심 + 백엔드가 .NET. 자연스러운 선택이다

프레임워크가 해 주는 일을 `01-what-is-an-agent.md` 기준으로 말하면 이렇다. 도구 함수에서 JSON Schema 를 만들어 모델에게 보내는 일, 모델이 보낸 `tool_use` 를 받아 해당 C# 메서드를 실행하는 일, 결과를 대화에 붙여 다시 호출하는 while 루프, 그리고 대화 기록 관리다. 이걸 직접 짜면 프로바이더마다 다른 JSON 형식을 다 맞춰야 한다. 프레임워크를 쓰면 그 차이를 감춰 준다.

React 에 비유하면 DOM 을 직접 조작하던 일을 React 가 맡아 주는 것과 비슷하다. 대신 내부에서 무슨 일이 일어나는지 모르면 문제가 생겼을 때 손을 못 댄다. 그래서 01 의 루프를 먼저 이해하고 들어오는 게 좋다.

---

## 2. 핵심 개념 (프레임워크가 바뀌어도 남는 것)

### AI Agent
모델 + 지시(instructions) + 도구 묶음. 대화 상대 하나.

instructions 는 시스템 프롬프트다. 모든 대화의 맨 앞에 붙어 "너는 어떤 역할이고 무엇을 하면 안 된다"를 정한다. 같은 모델이라도 instructions 와 도구 목록이 다르면 다른 에이전트가 된다. 규정 안내 에이전트와 견적 작성 에이전트가 모델 하나를 같이 쓰는 식이다.

### Tool / Function
C# 메서드에 어트리뷰트를 붙이면 스키마가 자동 생성되어 모델에게 노출된다.
`01-what-is-an-agent.md` 의 tool calling 이 이것.

어트리뷰트(attribute)는 C# 에서 메서드나 매개변수에 붙이는 메타데이터 표시다. TS 데코레이터와 생김새가 비슷하다. 프레임워크는 리플렉션(실행 중에 메서드 이름·매개변수 타입·어트리뷰트를 읽는 기능)으로 메서드를 훑어 `string query` 는 `"type": "string"` 으로, `string? department = null` 은 "필수 아님"으로 바꿔 JSON Schema 를 만든다. 01 에서 손으로 썼던 스키마를 C# 시그니처가 대신하는 셈이다.

### Thread / Conversation
대화 상태. 어디에 저장하느냐가 설계 포인트 (메모리 / Redis / DB).
**서버가 여러 대면 인메모리는 안 된다.**

모델이 이전 대화를 기억하지 못하니 매 호출에 대화 기록을 다시 넣어야 한다. Thread 는 그 기록을 담는 객체다. 인메모리가 안 되는 이유는 로드 밸런서가 같은 사용자의 다음 요청을 다른 서버로 보낼 수 있기 때문이다. 서버 A 의 메모리에 있는 대화는 서버 B 가 볼 수 없다(`07-db-infra/05-infra.md` 의 무상태 절).

> ❓ 입사 후 확인: 이 개념의 실제 타입 이름. 버전에 따라 이름이 바뀌었을 수 있다.

### Workflow
에이전트와 함수를 **그래프로 연결**하는 것. 순차·병렬·조건 분기.
`01-what-is-an-agent.md` 의 "워크플로우 vs 에이전트" 에서 말한 고정 경로 쪽.

그래프는 노드(할 일)와 간선(다음에 어디로 갈지)으로 이뤄진다. "검색 노드 → 요약 노드 → 조건: 금액이 기준 이상이면 승인 노드, 아니면 발송 노드" 같은 순서도를 코드로 옮긴 것이다. 노드 중 일부만 에이전트이고 나머지는 일반 함수다.

### Orchestration 패턴
여러 에이전트를 어떻게 엮을지 — 순차, 동시, 그룹 채팅, 핸드오프, 매니저-워커.

각 패턴은 "다음에 누가 일하느냐를 누가 정하느냐"로 갈린다.

- 순차: A 의 결과를 B 가 받고 B 의 결과를 C 가 받는다. 순서는 코드가 정한다.
- 동시: 같은 입력을 여러 에이전트에게 동시에 주고 결과를 모은다. 서로 다른 관점의 검토를 한꺼번에 받을 때 쓴다.
- 그룹 채팅: 여러 에이전트가 하나의 대화 기록을 공유하며 돌아가며 말한다. 발언 순서는 진행자 역할의 코드나 에이전트가 정한다.
- 핸드오프: 지금 대화를 맡은 에이전트가 "이건 재무 담당이 맞다"고 판단해 대화 전체를 다른 에이전트에게 넘긴다. 콜센터의 전화 돌려주기와 같다.
- 매니저-워커: 매니저 에이전트가 일을 쪼개 워커들에게 나눠 주고 결과를 모아 정리한다. 01 의 Orchestrator 그림이 이 모양이다.

### Middleware
에이전트 호출과 도구 실행 전후에 끼어드는 훅.
**로깅·승인·필터링·비용 측정이 여기 붙는다.** ASP.NET Core 미들웨어와 같은 발상이다.

프론트로 치면 axios 인터셉터나 Redux 미들웨어다. 도구 실행 직전에 끼어들어 "삭제 도구면 승인 대기로 돌린다", 모델 호출 직후에 끼어들어 "사용한 토큰 수를 기록한다" 같은 일을 한다. 이런 공통 관심사를 도구마다 복붙하지 않고 한곳에서 처리하려고 둔다.

---

## 3. 코드가 대략 어떻게 생겼나

> ⚠️ 아래는 **개념 예시**다. 실제 타입명·메서드명은 버전마다 다르다. 그대로 복붙하지 마라.

```csharp
// 도구: 그냥 메서드에 설명을 붙인다
public sealed class DocumentTools(IRagService rag)   // 의존성은 생성자로 받는다
{
    [Description("사내 문서를 검색한다. 규정·정책·매뉴얼 질문에 사용.")]
    public async Task<string> SearchDocumentsAsync(
        [Description("검색어")] string query,
        [Description("부서 코드")] string? department = null,
        CancellationToken ct = default)
    {
        var hits = await rag.SearchAsync(query, department, ct);
        return string.Join("\n", hits.Select((h, i) => $"[{i+1}] ({h.Source}) {h.Content}"));
    }
}

// 에이전트 구성
var agent = new ChatClientAgent(
    chatClient,
    instructions: "당신은 사내 규정 안내 어시스턴트입니다. 문서 근거 없이 답하지 마십시오.",
    tools: [AIFunctionFactory.Create(documentTools.SearchDocumentsAsync)]);

// 실행 (스트리밍)
await foreach (var update in agent.RunStreamingAsync(userMessage, thread, ct))
    await WriteSseAsync(update.Text, ct);
```

**여기서 봐야 할 것 세 가지:**
1. `[Description]` 이 모델에게 가는 프롬프트다 — 한국어로 쓰면 한국어로 전달된다
2. `RunStreamingAsync` 가 `IAsyncEnumerable` 을 돌려준다 → SSE 로 그대로 흘려보낸다
3. `thread` 가 대화 상태 — **어디에 영속화할지는 우리가 정한다**

### IAsyncEnumerable 과 await foreach

`IAsyncEnumerable<T>` 는 "값이 시간차를 두고 하나씩 도착하는 목록"이다. JS 의 async generator(`async function*`)와 `for await...of` 에 그대로 대응한다.

```ts
// TS 로 옮기면 이런 모양
for await (const update of agent.runStreaming(message)) {
  writeSse(update.text);
}
```

`Task<string>` 은 답 전체가 완성된 뒤 한 번에 받는 Promise 다. 반면 `IAsyncEnumerable` 은 모델이 토큰 몇 개를 만들 때마다 `update` 가 하나씩 나온다. 이걸 받는 족족 SSE 로 내보내면 사용자는 첫 글자부터 볼 수 있다. 전체 연결은 `05-realtime-ui/01-sse-vs-websocket.md` 4장에 있다.

### CancellationToken 을 끝까지 넘긴다

위 코드에서 `ct` 가 세 군데 나온다. 엔드포인트가 받은 토큰을 `RunStreamingAsync` 에 넘긴다. 프레임워크는 도구를 실행할 때 그 토큰을 도구의 `ct` 로 넘기고 도구는 다시 `rag.SearchAsync` 에 넘긴다. 사용자가 탭을 닫으면 이 사슬을 따라 모든 단계가 멈춘다. 도구 메서드에서 `ct` 를 빼먹으면 그 도구만 끝까지 돈다.

`CancellationToken` 매개변수는 모델에게 보내는 스키마에서 빠지고 프레임워크가 알아서 채워 주는 게 일반적이다.

> ❓ 입사 후 확인: 사내 버전에서도 도구의 `CancellationToken` 매개변수가 스키마에서 제외되고 자동 주입되는지.

도구 안에서는 비동기를 끝까지 비동기로 쓴다. `SearchAsync(...).Result` 처럼 결과를 동기로 기다리면 스레드를 붙잡고 있게 되고 상황에 따라 교착(deadlock)이 생긴다. TS 에서 `await` 를 빼먹는 것보다 훨씬 찾기 어려운 버그다(`02-csharp-dotnet/01-csharp-for-ts-devs.md`).

### DI 등록

```csharp
builder.Services.AddSingleton<IChatClient>(sp =>
    new AzureOpenAIClient(endpoint, credential).GetChatClient(deployment).AsIChatClient());
builder.Services.AddScoped<IAgentService, CxpAgentService>();
```

`IChatClient` 는 `Microsoft.Extensions.AI` 의 **프로바이더 중립 추상**이다.
OpenAI / Azure OpenAI / Anthropic / 로컬 모델을 같은 인터페이스로 바꿔 끼운다.
**랭코드가 "벤더 중립"을 내세우는 것과 이 추상이 맞아떨어진다.**

생명주기를 이렇게 나눈 이유가 있다. 모델 클라이언트는 내부에 HTTP 연결 풀을 갖고 있어서 앱 전체가 하나를 재사용하는 게 맞다(Singleton). 요청마다 새로 만들면 연결을 매번 새로 맺느라 느려지고 소켓이 고갈될 수 있다. `new HttpClient()` 를 직접 만들지 말라는 .NET 의 오래된 규칙과 같은 이유다. 반면 에이전트 서비스는 요청한 사용자의 권한이나 테넌트 정보를 다뤄야 하니 요청 단위(Scoped)가 맞다. Singleton 안에 Scoped 를 주입하면 첫 사용자의 정보가 다음 사용자에게 새는 사고가 난다(`01-backend-basics/02-layers-and-di.md` 4장).

`endpoint`, `deployment` 같은 값은 코드에 박지 않고 설정에서 읽는다. 타입 있는 설정(Options 패턴)으로 묶는다. 키나 자격 증명은 Key Vault 와 Managed Identity 로 받는다(`02-csharp-dotnet/02-aspnet-core.md` 4장, `07-db-infra/05-infra.md` 5장).

`Microsoft.Extensions.AI` 에는 `IChatClient` 를 겹겹이 감싸 기능을 붙이는 방식도 있다. 도구 호출 루프를 자동으로 돌려 주는 층, 로깅이나 OpenTelemetry 추적을 붙이는 층을 미들웨어처럼 쌓는다. 01 에서 직접 짠 while 루프가 이 중 한 층으로 들어가 있다고 보면 된다.

> ❓ 입사 후 확인: 사내 코드가 이 파이프라인 방식을 쓰는지, 쓴다면 어떤 층을 어떤 순서로 쌓는지.

---

## 4. Semantic Kernel 과의 관계

고객사 기존 코드나 사내 레거시에 **Semantic Kernel** 이 남아 있을 수 있다.

| SK 용어 | MAF 에서 |
| --- | --- |
| Kernel | 에이전트 / 서비스 컨테이너 |
| Plugin / KernelFunction | Tool / AIFunction |
| Planner | Workflow / 오케스트레이션 |
| Memory | Thread / 상태 저장소 |

**개념은 거의 1:1 로 대응된다.** SK 코드를 만나도 당황할 필요 없다.

SK 의 Plugin 은 관련된 도구 함수를 클래스 하나로 묶은 것이다. 위 예시의 `DocumentTools` 클래스가 그 모양이다. Planner 는 모델에게 계획을 세우게 하는 기능이었다. MAF 에서는 계획을 코드로 고정하는 Workflow 와 에이전트끼리 조율하는 오케스트레이션으로 나뉘었다.

---

## 5. 입사 전에 해볼 것 (선택)

dotnet 세팅이 끝났다면 30분짜리 실험.

```bash
mkdir /tmp/maf-try && cd /tmp/maf-try
dotnet new console
dotnet add package Microsoft.Extensions.AI
dotnet add package Microsoft.Extensions.AI.OpenAI
# MAF 패키지명은 공식 문서에서 확인할 것 (프리뷰 여부·이름이 바뀔 수 있다)
```

**API 키가 없으면 안 된다.** 없으면 `labs/lab2-mini-rag` (키 불필요) 를 먼저 하고,
MAF 는 개념만 읽고 넘어가라. **입사하면 사내 키와 실제 코드가 있다.** 그게 훨씬 빠르다.

실험을 한다면 목표는 하나면 충분하다. 도구 하나(현재 시각을 돌려주는 함수 정도)를 붙이고 "지금 몇 시야?" 를 물어, 모델이 도구를 요청하고 결과를 받아 답하는 과정을 로그로 확인한다. 01 의 네 단계가 실제로 오가는 걸 한 번 보면 프레임워크 코드가 훨씬 덜 낯설다.

---

## 6. 입사 후 확인할 것

- [ ] MAF 버전과 프리뷰 여부. 사내에서 어디까지 쓰나 (에이전트만? 워크플로우도?)
- [ ] **MAF 와 "랭코드 자체 Agentic AI 코어" 의 경계는 어디인가** ← 가장 궁금한 것
- [ ] 대화 상태(Thread)를 어디에 저장하나. 멀티 인스턴스에서 어떻게 공유하나
- [ ] 도구(Tool) 는 어떻게 등록·관리되나. 고객사별로 다른 도구 세트를 어떻게 구성하나
- [ ] 도구 승인(human-in-the-loop) 흐름이 있나
- [ ] 모델 프로바이더 전환은 설정만으로 되나
- [ ] 관측(trace) 은 뭘 쓰나 — OpenTelemetry? Application Insights? 자체?
- [ ] 프롬프트는 어디서 버전 관리되나 (코드 안? DB? 별도 도구?)
- [ ] 도구 메서드까지 `CancellationToken` 이 전달되나. 도구 하나의 타임아웃은 얼마로 두나

---

## 스스로 답해보기

1. MAF 를 쓰면 `01-what-is-an-agent.md` 의 네 단계 중 어떤 일을 프레임워크가 대신하나?
2. C# 메서드 시그니처에서 JSON Schema 가 어떻게 만들어지나? `string? department = null` 은 스키마에서 어떻게 표현되나?
3. 서버가 세 대일 때 Thread 를 인메모리에 두면 어떤 증상이 생기나?
4. 핸드오프와 매니저-워커의 차이를 "다음 담당을 누가 정하나" 로 설명해 보라.
5. `RunStreamingAsync` 가 `Task<string>` 이 아니라 `IAsyncEnumerable` 을 돌려주는 이유는?
6. `IChatClient` 는 Singleton, 에이전트 서비스는 Scoped 로 등록한 이유는?
