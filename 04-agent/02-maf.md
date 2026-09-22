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

---

## 2. 핵심 개념 (프레임워크가 바뀌어도 남는 것)

### AI Agent
모델 + 지시(instructions) + 도구 묶음. 대화 상대 하나.

### Tool / Function
C# 메서드에 어트리뷰트를 붙이면 스키마가 자동 생성되어 모델에게 노출된다.
`01-what-is-an-agent.md` 의 tool calling 이 이것.

### Thread / Conversation
대화 상태. 어디에 저장하느냐가 설계 포인트 (메모리 / Redis / DB).
**서버가 여러 대면 인메모리는 안 된다.**

### Workflow
에이전트와 함수를 **그래프로 연결**하는 것. 순차·병렬·조건 분기.
`01-what-is-an-agent.md` 의 "워크플로우 vs 에이전트" 에서 말한 고정 경로 쪽.

### Orchestration 패턴
여러 에이전트를 어떻게 엮을지 — 순차, 동시, 그룹 채팅, 핸드오프, 매니저-워커.

### Middleware
에이전트 호출과 도구 실행 전후에 끼어드는 훅.
**로깅·승인·필터링·비용 측정이 여기 붙는다.** ASP.NET Core 미들웨어와 같은 발상이다.

---

## 3. 코드가 대략 어떻게 생겼나

> ⚠️ 아래는 **개념 예시**다. 실제 타입명·메서드명은 버전마다 다르다. 그대로 복붙하지 마라.

```csharp
// 도구: 그냥 메서드에 설명을 붙인다
[Description("사내 문서를 검색한다. 규정·정책·매뉴얼 질문에 사용.")]
static async Task<string> SearchDocumentsAsync(
    [Description("검색어")] string query,
    [Description("부서 코드")] string? department = null)
{
    var hits = await _rag.SearchAsync(query, department);
    return string.Join("\n", hits.Select((h, i) => $"[{i+1}] ({h.Source}) {h.Content}"));
}

// 에이전트 구성
var agent = new ChatClientAgent(
    chatClient,
    instructions: "당신은 사내 규정 안내 어시스턴트입니다. 문서 근거 없이 답하지 마십시오.",
    tools: [AIFunctionFactory.Create(SearchDocumentsAsync)]);

// 실행 (스트리밍)
await foreach (var update in agent.RunStreamingAsync(userMessage, thread, ct))
    await WriteSseAsync(update.Text, ct);
```

**여기서 봐야 할 것 세 가지:**
1. `[Description]` 이 모델에게 가는 프롬프트다 — 한국어로 쓰면 한국어로 전달된다
2. `RunStreamingAsync` 가 `IAsyncEnumerable` 을 돌려준다 → SSE 로 그대로 흘려보낸다
3. `thread` 가 대화 상태 — **어디에 영속화할지는 우리가 정한다**

### DI 등록

```csharp
builder.Services.AddSingleton<IChatClient>(sp =>
    new AzureOpenAIClient(endpoint, credential).GetChatClient(deployment).AsIChatClient());
builder.Services.AddScoped<IAgentService, CxpAgentService>();
```

`IChatClient` 는 `Microsoft.Extensions.AI` 의 **프로바이더 중립 추상**이다.
OpenAI / Azure OpenAI / Anthropic / 로컬 모델을 같은 인터페이스로 바꿔 끼운다.
**랭코드가 "벤더 중립"을 내세우는 것과 이 추상이 맞아떨어진다.**

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
