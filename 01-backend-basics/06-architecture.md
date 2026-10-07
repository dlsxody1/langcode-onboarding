# 아키텍처 패턴 — DDD · Clean · Vertical Slice · CQRS · Mediator · 모듈러 모놀리스

`02-layers-and-di.md` 에서 Controller → Service → Repository 세 층을 봤다. 작은 서비스는 그걸로 충분하다.
기능이 수백 개로 늘고 팀이 여러 개가 되면 세 층만으로는 버티기 어렵다. 이 문서의 여섯 가지는 그때 꺼내는 도구들이다.

**먼저 오해 하나를 지운다. 여섯 개는 서로 경쟁하는 선택지가 아니다.** 각자 다른 질문에 답하고, 실무에서는 겹쳐서 쓴다.

| 패턴 | 답하는 질문 | 프론트로 치면 |
| --- | --- | --- |
| **DDD** | 업무 규칙을 **어떤 모양의 코드**로, 어디에 둘까 | 상태와 규칙을 한 store 안에 가두기 |
| **Clean Architecture** | 프로젝트끼리 **누가 누구를 참조**해도 되나 | FSD 의 레이어 import 규칙 |
| **Mediator (MediatR)** | 컨트롤러와 처리 로직을 **어떻게 이어 줄까** | Redux 의 `dispatch(action)` → reducer |
| **CQRS** | **쓰기와 읽기**를 같은 코드로 할까 | React Query 의 mutation 과 query |
| **Vertical Slice** | 파일을 **무엇 기준으로** 폴더에 묶을까 | FSD 의 slice, Next.js 의 라우트별 폴더 |
| **모듈러 모놀리스** | 큰 시스템을 **어떤 경계**로 나누고, 배포는 몇 개로 할까 | 모노레포 안의 패키지들 |

한 시스템 안에서 이렇게 포개진다.

```
하나의 배포 단위 (모놀리스)
└─ 모듈: 주문 / 상품 / 고객 …                       ← 모듈러 모놀리스
   └─ 프로젝트 4개: Contracts · Domain · Application · Infrastructure   ← Clean Architecture
      ├─ Domain: Order, OrderItem 같은 업무 규칙 덩어리                ← DDD
      └─ Application: 기능별 폴더                                     ← Vertical Slice
         ├─ CreateOrder/  (쓰기: Command + Handler)                    ← CQRS
         └─ GetOrder/     (읽기: Query + Handler)
            컨트롤러는 mediator.Send(...) 한 줄로 핸들러를 부른다       ← Mediator
```

아래 설명은 전부 같은 예제로 간다.

> **공통 예제: 쇼핑몰 주문.** 고객이 상품을 장바구니에 담고, 주문을 만들고, 주문 내역을 조회한다.
> 기술은 ASP.NET Core · C# · EF Core 다. (`02-csharp-dotnet/` 을 먼저 읽었다면 문법이 낯설지 않다)

---

## 1. DDD (Domain-Driven Design, 도메인 주도 설계)

### 무슨 문제를 푸나

`02-layers-and-di.md` 의 Service 에는 업무 규칙이 `if` 문으로 쌓인다. 처음엔 괜찮다. 그런데 "주문"에 관한 규칙이
`OrderService`, `CartService`, `PaymentService`, 관리자용 `AdminOrderService` 에 조금씩 흩어지면 이런 일이 생긴다.

- "결제 완료된 주문은 수정할 수 없다" 를 한 곳에서만 검사하고 다른 곳에서는 빠뜨린다
- 주문 합계를 세 군데서 각자 계산하고, 할인 규칙이 바뀌었을 때 두 군데만 고친다
- 엔티티는 데이터만 담은 빈 상자고(`public set` 투성이), 누구나 `order.Status = "Paid"` 로 바꿀 수 있다

**DDD 는 "업무 규칙을 그 데이터를 가진 객체 안에 가둔다"** 는 생각에서 출발한다. 규칙을 지키지 않고는 상태를 바꿀 방법이 없게 만든다.

### 빈약한 모델 vs 풍부한 모델

```csharp
// ❌ 빈약한 모델 (anemic model): 데이터만 있고 규칙은 밖(Service)에 있다
public class Order
{
    public int Id { get; set; }
    public string Status { get; set; } = "Draft";
    public List<OrderItem> Items { get; set; } = new();
    public decimal Total { get; set; }            // 누가 계산해서 넣어 주길 기대한다
}

// ✅ 풍부한 모델 (rich model): 규칙이 객체 안에 있다
public class Order
{
    private readonly List<OrderItem> _items = new();

    public int Id { get; private set; }
    public int CustomerId { get; private set; }
    public OrderStatus Status { get; private set; } = OrderStatus.Draft;
    public IReadOnlyList<OrderItem> Items => _items;          // 밖에서는 읽기만
    public Money Total => _items.Aggregate(Money.Zero, (sum, i) => sum + i.Subtotal);   // 항상 계산된 값

    public Order(int customerId) => CustomerId = customerId;

    public void AddItem(int productId, Money unitPrice, int quantity)
    {
        if (Status != OrderStatus.Draft) throw new DomainException("확정된 주문에는 상품을 담을 수 없다");
        if (quantity <= 0) throw new DomainException("수량은 1 이상이어야 한다");
        _items.Add(new OrderItem(productId, unitPrice, quantity));
    }

    public void Place()
    {
        if (_items.Count == 0) throw new DomainException("빈 주문은 확정할 수 없다");
        Status = OrderStatus.Placed;
    }
}
```

`private set` 과 `IReadOnlyList` 때문에 밖에서는 `order.Status = ...` 를 쓸 수 없다. **상태를 바꾸는 유일한 길이 규칙을 통과하는 메서드다.**
그래서 "결제 후 수정 불가" 를 Service 백 개 중 하나가 빠뜨리는 일이 원천적으로 없다.

### 알아 둘 용어

| 용어 | 뜻 | 예제에서 |
| --- | --- | --- |
| **유비쿼터스 언어** | 기획자·개발자가 같은 단어를 쓰고, 그 단어를 코드 이름에 그대로 쓴다 | 기획서가 "주문 확정"이면 메서드도 `Place()` 다. `UpdateStatus2()` 가 아니다 |
| **엔티티 (Entity)** | **식별자(Id)** 로 구별되는 객체. 내용이 바뀌어도 같은 것 | 주문 #1001 은 상품을 더 담아도 #1001 이다 |
| **값 객체 (Value Object)** | **값 자체**로 구별되는 객체. 바뀌지 않고, 바꾸려면 새로 만든다 | `Money(10000, "KRW")`. 1만 원짜리 두 개는 같은 것이다 |
| **애그리거트 (Aggregate)** | 함께 바뀌어야 하는 객체 묶음. 바깥은 **루트**를 통해서만 안을 건드린다 | `Order` 가 루트, `OrderItem` 은 안쪽. 아이템을 직접 저장하지 않고 `order.AddItem()` 을 거친다 |
| **도메인 이벤트** | "일어난 일"을 객체로 남긴 것. 다른 곳이 듣고 반응한다 | `OrderPlaced` → 재고 차감, 확인 메일 |
| **리포지토리** | 애그리거트 하나를 통째로 저장·조회하는 창구 | `IOrderRepository.GetAsync(id)` 가 아이템까지 담긴 `Order` 를 돌려준다 |
| **바운디드 컨텍스트** | 같은 단어가 같은 뜻으로 통하는 경계 | "상품"이 카탈로그에서는 설명·사진, 주문에서는 주문 당시 가격. **경계마다 모델을 따로** 둔다 |

**값 객체가 왜 좋은가.** `decimal price` 로 들고 다니면 원화와 달러를 더하는 실수를 컴파일러가 못 잡는다.
`Money` 로 감싸면 `+` 연산자 안에서 통화가 다르면 예외를 던지게 할 수 있다. 규칙이 타입에 들어간다.

**바운디드 컨텍스트가 5절 모듈러 모놀리스의 "모듈 경계"가 된다.** 경계를 어디에 긋느냐가 DDD 에서 가장 어렵고 가장 중요한 결정이다.

### 언제 쓰나 / 안 쓰나

| 쓴다 | 안 쓴다 |
| --- | --- |
| 업무 규칙이 많고 자주 바뀐다 (주문·결제·정산·보험·물류) | 입력 받아 저장하고 보여 주면 끝인 CRUD (게시판, 설정 화면) |
| 기획자와 계속 대화하며 규칙을 다듬는 도메인 | 규칙보다 화면·연동이 대부분인 서비스 |
| 같은 규칙을 여러 기능이 공유한다 | 혼자 만드는 짧은 프로젝트 |

> 전부를 DDD 로 짤 필요는 없다. 규칙이 복잡한 **핵심 영역**(주문)에만 쓰고, 단순한 곳(공지사항)은 평범한 CRUD 로 둔다.

---

## 2. Clean Architecture (클린 아키텍처)

### 무슨 문제를 푸나

`02-layers-and-di.md` 의 세 층에서 **Service 는 Repository 에 의존**한다. 즉 업무 규칙(Service)이 데이터 접근(EF Core)을 안다.
그러면 업무 규칙을 테스트하려 해도 DB 가 필요하고, ORM 을 바꾸면 업무 규칙 코드까지 흔들린다.

Clean Architecture 의 규칙은 한 줄이다. **의존은 항상 안쪽(업무 규칙)을 향한다. 안쪽은 바깥을 모른다.**

```
     바깥 ─────────────────────────────▶ 안쪽
Infrastructure  →  Application  →  Domain
(EF Core, 외부 API)  (유스케이스)      (엔티티·규칙)
```

- **Domain** 은 아무것도 참조하지 않는다. EF Core 도, ASP.NET 도 모른다. 순수한 C# 클래스뿐이다
- **Application** 은 Domain 을 쓰고 "무엇을 할지"(유스케이스)를 적는다. 저장이 필요하면 **인터페이스만** 선언한다
- **Infrastructure** 가 그 인터페이스를 EF Core 로 구현한다

### 의존성 역전 — 이 구조의 핵심 기술

"Application 이 DB 에 저장해야 하는데 DB 를 모른다"가 어떻게 가능한가. 인터페이스를 **안쪽이 소유**하면 된다.

```csharp
// Application 프로젝트 — 인터페이스를 여기서 정의한다 (안쪽이 "나는 이런 게 필요하다"고 선언)
public interface IOrderRepository
{
    Task<Order?> GetAsync(int id, CancellationToken ct);
    void Add(Order order);
}

// Infrastructure 프로젝트 — 바깥이 그 요구에 맞춰 구현한다
public class EfOrderRepository(AppDbContext db) : IOrderRepository
{
    public Task<Order?> GetAsync(int id, CancellationToken ct) =>
        db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == id, ct);
    public void Add(Order order) => db.Orders.Add(order);
}

// 시작 프로젝트(WebApi)에서 연결 — 이 한 줄만 바꾸면 저장소가 바뀐다
builder.Services.AddScoped<IOrderRepository, EfOrderRepository>();
```

코드의 **호출**은 Application → Infrastructure 방향으로 일어나지만, **참조(import)**는 Infrastructure → Application 이다.
호출 방향과 참조 방향이 반대라서 "의존성 **역전**"이라고 부른다. DI(`02-layers-and-di.md` 3절)가 런타임에 둘을 이어 준다.

### 모듈 하나를 프로젝트 네 개로

.NET 에서는 층마다 **프로젝트(.csproj)** 를 따로 만드는 경우가 많다. 주문 모듈이라면 이런 모양이다 (이름은 예시).

```
                                   +---------------------------+
                                   |  Ordering.Contracts        |
                                   |  (DTO: 밖에 보여 줄 모양)   |
                                   +---------------------------+
                                                 ▲
                                                 │
+---------------------------+     +---------------------------+     +-------------------------------+
|  Ordering.Domain           |◀───|  Ordering.Application      |◀───|  Ordering.Infrastructure       |
|  (엔티티 · 도메인 규칙)     |     |  (CQRS 핸들러 · 서비스)     |     |  (EF Core 설정 · 리포지토리)   |
+---------------------------+     +---------------------------+     +-------------------------------+
              ▲                                                                       │
              └───────────────────────────────────────────────────────────────────────┘
```

화살표는 "참조한다"는 뜻이다.

| 프로젝트 | 참조해도 되는 것 | 절대 참조하면 안 되는 것 |
| --- | --- | --- |
| Contracts | 없음 (DTO 만 있다) | Domain, Application, Infrastructure |
| Domain | 없음 | 나머지 전부 |
| Application | Domain, Contracts | Infrastructure |
| Infrastructure | Application, Domain | (위로 올라오는 쪽은 없다) |

**역참조와 정의되지 않은 참조는 금지다.** 예를 들어 Contracts 가 Domain 을 참조하면 DTO 에 엔티티가 섞여 밖으로 새고(`02-layers-and-di.md` 2절의 문제),
Domain 이 Infrastructure 를 참조하면 업무 규칙이 EF Core 에 묶인다.

**프로젝트로 나누는 이유는 컴파일러에게 규칙을 지키게 하려는 것이다.** 폴더로만 나누면 아무 데서나 `using` 할 수 있다.
프로젝트로 나누면 `ProjectReference` 에 없는 프로젝트는 아예 import 가 안 된다. 사람의 주의력 대신 빌드가 막는다.
FSD 에서 eslint 경계 규칙으로 "features 가 pages 를 import 하면 에러"를 거는 것과 같은 발상이다.

> **Contracts 는 왜 따로 있나.** 다른 모듈이나 프론트가 알아야 하는 건 "주문 생성 요청은 이런 모양, 응답은 이런 모양"뿐이다.
> 그 모양(DTO)만 담은 얇은 프로젝트를 두면, 다른 모듈은 Contracts 만 참조하고 주문 모듈의 내부(Domain, DB)는 모른 채로 남는다.

### 언제 쓰나 / 안 쓰나

| 쓴다 | 안 쓴다 |
| --- | --- |
| 수년 동안 유지보수할 시스템 | 몇 달 쓰고 버릴 프로토타입 |
| 업무 규칙을 DB 없이 단위 테스트하고 싶다 | 로직이 거의 없어 테스트할 규칙이 없다 |
| 외부 연동·저장소가 바뀔 가능성이 있다 (DB, 메시지 큐, 외부 API) | 프로젝트 네 개가 코드보다 더 커 보이는 작은 서비스 |

> 비용: 파일과 프로젝트가 늘고, 기능 하나에 손대는 곳이 많아진다. 그래서 4절 Vertical Slice 와 함께 쓰는 경우가 많다.

---

## 3. Mediator 패턴과 MediatR — 요청과 처리 로직 분리

### 무슨 문제를 푸나

컨트롤러가 서비스를 직접 부르면, 기능이 늘수록 컨트롤러 생성자에 서비스가 줄줄이 붙는다.
그리고 "모든 요청에 입력 검증 · 로그 · 트랜잭션" 같은 공통 처리를 서비스마다 반복해서 쓰게 된다.

Mediator(중재자)는 둘 사이에 **우체국**을 하나 둔다. 컨트롤러는 "이 요청 처리해 줘"라는 **편지(요청 객체)** 를 우체국에 넣기만 하고,
우체국이 그 편지를 받을 **핸들러**를 찾아 전달한다. 컨트롤러는 누가 처리하는지 모른다.

### 코드

```csharp
// ① 요청: "무엇을 원하는가"만 담은 객체. 응답 타입을 IRequest<T> 로 적는다
public record CreateOrderCommand(int CustomerId, List<CartLineDto> Lines) : IRequest<OrderResultDto>;
public record CartLineDto(int ProductId, int Quantity);   // 가격은 받지 않는다 — 클라이언트가 보낸 가격을 믿으면 가격 조작이 된다

// ② 핸들러: 그 요청 하나만 처리한다
public class CreateOrderHandler(IOrderRepository orders, IProductPrices prices, IUnitOfWork uow)
    : IRequestHandler<CreateOrderCommand, OrderResultDto>
{
    public async Task<OrderResultDto> Handle(CreateOrderCommand cmd, CancellationToken ct)
    {
        // 가격은 상품 쪽에 물어본다 (6절: 다른 모듈은 Contracts 로만 대화한다)
        var unitPrices = await prices.GetAsync(cmd.Lines.Select(l => l.ProductId), ct);

        var order = new Order(cmd.CustomerId);
        foreach (var l in cmd.Lines) order.AddItem(l.ProductId, unitPrices[l.ProductId], l.Quantity);  // 규칙은 Domain 이 지킨다
        order.Place();

        orders.Add(order);
        await uow.SaveChangesAsync(ct);
        return new OrderResultDto(order.Id, order.Total.Amount);
    }
}

// ③ 컨트롤러: 보내기만 한다
[HttpPost]
public async Task<ActionResult<OrderResultDto>> Create(CreateOrderCommand cmd, CancellationToken ct)
    => Ok(await _mediator.Send(cmd, ct));
```

- `IRequest<TResponse>` — "나는 요청이고, 처리하면 `TResponse` 가 나온다"
- `IRequestHandler<TRequest, TResponse>` — "나는 `TRequest` 를 처리해서 `TResponse` 를 돌려준다"
- `Send()` — DI 에 등록된 핸들러 중 요청 타입에 맞는 것을 찾아 `Handle` 을 부른다. 등록은 시작할 때 어셈블리를 훑어 한 번에 한다

### 파이프라인 — 진짜 이득은 여기

요청이 핸들러에 닿기 전에 거치는 단계를 끼워 넣을 수 있다(MediatR 에서는 `IPipelineBehavior`).
`01-request-lifecycle.md` 의 미들웨어와 똑같은 양파 구조인데, HTTP 가 아니라 **요청 객체** 단위로 돈다.

```
mediator.Send(cmd)
   → 로깅 (요청 이름·걸린 시간)
      → 입력 검증 (FluentValidation 으로 CreateOrderValidator 실행, 실패하면 핸들러까지 안 감)
         → 트랜잭션 (Command 일 때만 열고 닫기)
            → CreateOrderHandler.Handle
```

검증·로그·트랜잭션을 **한 번만** 쓰면 모든 핸들러에 적용된다. 핸들러는 업무 흐름만 남는다.

### 코드 읽을 때의 함정

컨트롤러에서 `Send(cmd)` 를 Go to Definition 하면 MediatR 내부로 가고 길이 끊긴다(`02-csharp-dotnet/04-reading-a-dotnet-codebase.md`).
**요청 클래스 이름 + `Handler` 로 검색**한다. `CreateOrderCommand` → `CreateOrderHandler` (또는 `CreateOrderCommandHandler`).

### MediatR 라이선스와 사내 구현

> 📌 팀 기술 목록에서 MediatR 은 **(X, 상용)** 이고 "직접 구현과 비교 후 다시 논의"로 남아 있다. 세 가지 선택지 비교는 `02-csharp-dotnet/05-team-tech-list.md` 4절.

MediatR 은 .NET 에서 이 패턴의 사실상 표준 라이브러리였는데, 최근 버전부터 **상용 라이선스로 바뀌었다.**
그래서 라이브러리 대신 **팀이 직접 만든 Mediator 를 패키지로 쓰는** 곳이 늘고 있다.
이때 보통 `IRequest`, `IRequestHandler`, `Send` 같은 **이름과 사용법을 MediatR 과 최대한 비슷하게** 맞춘다.
그래서 MediatR 로 배운 개념과 코드 읽는 법이 그대로 통한다. 다만 파이프라인 등록 방법 같은 세부는 사내 구현을 확인해야 한다.

> 직접 만들어도 핵심은 작다. "요청 타입 → 핸들러 타입" 을 DI 에서 찾아 호출하는 것과, 그 앞뒤에 behavior 를 감싸는 것이 전부다.

### 언제 쓰나 / 안 쓰나

| 쓴다 | 안 쓴다 |
| --- | --- |
| 기능(유스케이스)이 많고, 검증·로그·트랜잭션 같은 공통 처리가 많다 | 엔드포인트 몇 개짜리 작은 API |
| 4절 Vertical Slice 로 기능마다 파일을 모을 때 (요청 + 핸들러가 한 쌍) | 팀이 간접 호출에 익숙하지 않아 "코드가 어디로 가는지 모르겠다"가 더 큰 비용일 때 |

---

## 4. CQRS (Command Query Responsibility Segregation)

### 무슨 문제를 푸나

쓰기와 읽기는 원하는 것이 다르다.

| | 쓰기 (Command) | 읽기 (Query) |
| --- | --- | --- |
| 하는 일 | 상태를 바꾼다 | 상태를 보여 준다 |
| 중요한 것 | 규칙 검사, 일관성, 트랜잭션 | 빠르기, 화면에 딱 맞는 모양 |
| 좋은 모델 | 1절의 풍부한 `Order` 애그리거트 | 화면용 DTO (여러 테이블을 합친 평평한 모양) |
| 비율 | 적다 | 보통 훨씬 많다 |

한 모델로 둘 다 하려면 타협이 생긴다. 목록 화면 하나 그리려고 `Order` 애그리거트를 아이템까지 통째로 불러와 DTO 로 바꾸는 식이다.
**CQRS 는 "쓰기 모델과 읽기 모델을 나눈다"** 는 결정이다.

### 코드 — 읽기는 애그리거트를 거치지 않는다

```csharp
public record GetOrderQuery(int OrderId) : IRequest<OrderDto?>;

// Money 는 EF Core 에서 소유 타입(owned type)으로 매핑해 Amount 칼럼에 저장한다고 가정한다
public class GetOrderHandler(AppDbContext db) : IRequestHandler<GetOrderQuery, OrderDto?>
{
    public Task<OrderDto?> Handle(GetOrderQuery q, CancellationToken ct) =>
        db.Orders
            .AsNoTracking()                                   // 읽기만 하니 변경 추적 불필요 (02-csharp-dotnet/03-ef-core.md)
            .Where(o => o.Id == q.OrderId)
            .Select(o => new OrderDto(                        // 필요한 칼럼만 SELECT 한다
                o.Id,
                o.Items.Sum(i => i.UnitPrice.Amount * i.Quantity),
                o.Items.Select(i => new OrderItemDto(i.ProductId, i.UnitPrice.Amount, i.Quantity)).ToList()))
            .FirstOrDefaultAsync(ct);                         // 없으면 null → 컨트롤러가 404
}
```

쿼리 핸들러가 `IOrderRepository` 가 아니라 `AppDbContext` 를 바로 쓴 것도 의도다. 리포지토리는 **애그리거트를 통째로** 다루는 쓰기용 창구라서,
화면마다 모양이 다른 조회까지 넣으면 메서드가 끝없이 늘어난다. 그래서 조회 핸들러는 Infrastructure 쪽에 두거나, Application 에서 읽기 전용 DB 접근을 허용하는 식으로 팀이 규칙을 정한다.

흔한 실수 두 가지를 피했다.
- 주문이 없을 때를 처리한다. `FirstOrDefaultAsync` 결과를 바로 `o.Id` 로 쓰면 없는 주문 조회가 500 이 된다
- 응답에 엔티티(`o.Items`)를 그대로 넣지 않고 DTO 로 바꾼다. 엔티티를 내보내면 내부 필드가 새고 직렬화 순환이 생긴다

쓰기 쪽(`CreateOrderCommand`)은 3절처럼 애그리거트를 거쳐 규칙을 지키고, **한 핸들러 = 한 트랜잭션**으로 저장한다.

### CQRS 에는 단계가 있다

"CQRS 를 쓴다"가 별도 DB 를 뜻하는 건 아니다. 대부분은 1단계다.

| 단계 | 모양 | 비용 |
| --- | --- | --- |
| **1. 클래스만 나눈다** | 같은 DB, Command 핸들러와 Query 핸들러가 따로 | 거의 없다. **대부분 여기서 충분하다** |
| 2. 읽기 전용 모델 | 같은 DB 안에 조회용 뷰·비정규화 테이블 | 쓰기 때 조회용 테이블도 갱신해야 한다 |
| 3. 읽기 DB 분리 | 쓰기 DB → 이벤트 → 읽기 DB (검색엔진, 캐시, 복제본) | 두 DB 가 잠깐 어긋난다 (**최종 일관성**) |

**최종 일관성(eventual consistency)** 은 "지금 당장은 아니지만 곧 같아진다"는 뜻이다.
3단계에서는 주문을 만든 직후 목록을 새로고침하면 방금 만든 주문이 0.5초쯤 안 보일 수 있다. 화면도 그걸 감안해야 한다
(예: 생성 직후에는 응답으로 받은 데이터를 목록에 바로 끼워 넣는다 — React Query 의 낙관적 업데이트와 같은 처리).

### 언제 쓰나 / 안 쓰나

| 쓴다 | 안 쓴다 |
| --- | --- |
| 화면마다 조회 모양이 제각각이고 조회가 쓰기보다 훨씬 많다 | 쓰기 모양 = 읽기 모양인 단순 CRUD |
| 쓰기 규칙이 복잡해서 애그리거트를 쓰는데, 조회까지 애그리거트로 하면 느리다 | 3단계(읽기 DB 분리)를 "그냥 멋있어서" 도입 — 운영 복잡도만 는다 |

---

## 5. Vertical Slice (수직 슬라이스) — 기능 단위로 묶기

> 📌 팀 기술 목록에서 Vertical Slice 는 **취소선(제외)** 이다. 우리는 Clean Architecture 층 구조를 쓴다.
> 다른 팀 코드나 자료에서 자주 만나므로 개념은 알아 두되, 우리 코드에서 기능별 폴더를 기대하지는 않는다 (`02-csharp-dotnet/05-team-tech-list.md`).

### 무슨 문제를 푸나

계층별 폴더는 이런 모양이다.

```
/Controllers/OrdersController.cs
/Services/OrderService.cs
/Repositories/OrderRepository.cs
/Dtos/CreateOrderRequest.cs, OrderDto.cs …
/Validators/CreateOrderValidator.cs
```

"주문 생성" 기능 하나를 고치려면 폴더 다섯 개를 오간다. 그리고 `OrderService` 한 파일에 주문 관련 기능 서른 개가 몰려 2천 줄이 된다.

**Vertical Slice 는 폴더를 "층"이 아니라 "기능"으로 자른다.** 한 기능에 필요한 파일을 위(요청)에서 아래(저장)까지 한 폴더에 모은다.
케이크를 가로(층)가 아니라 세로로 한 조각 자르는 그림이라 "수직 슬라이스"다.

```
/Features
  /CreateOrder
    CreateOrderCommand.cs      요청
    CreateOrderHandler.cs      처리
    CreateOrderValidator.cs    입력 검증
    CreateOrderTests.cs        테스트
  /GetOrder
    GetOrderQuery.cs
    GetOrderHandler.cs
    GetOrderDto.cs
    GetOrderTests.cs
```

### 장점과 대가

- **한 기능 = 한 폴더.** 고칠 때 볼 곳이 하나고, 기능을 지우면 폴더째 지운다
- **기능끼리 서로를 덜 건드린다.** `GetOrder` 를 빠르게 하려고 쿼리를 바꿔도 `CreateOrder` 는 안전하다
- **새 기능은 비슷한 폴더를 복사해 뼈대로 쓴다**
- 대가: 기능 사이에 비슷한 코드가 생긴다. **어느 정도 중복은 허용**하고, 진짜 공통인 업무 규칙만 Domain(1절)으로 올린다.
  "공통처럼 보이는 것"을 성급하게 공용 서비스로 빼면 다시 2천 줄짜리 서비스가 생긴다

> 프론트에서 FSD 의 `features/` 아래를 기능별로 나누고, Next.js 의 `app/orders/[id]/` 에 그 화면의 컴포넌트·훅을 모아 두는 것과 같은 생각이다.

### Clean Architecture 와 함께 쓰면

둘은 부딪히지 않는다. **프로젝트(Domain · Application · Infrastructure)는 Clean 으로 나누고, Application 안을 Vertical Slice 로 정리**하는 조합이 흔하다.
Mediator(3절)의 요청 + 핸들러 쌍이 슬라이스 하나의 중심이 되고, CQRS(4절)에 따라 슬라이스가 Command 와 Query 로 갈린다.

### 언제 쓰나 / 안 쓰나

| 쓴다 | 안 쓴다 |
| --- | --- |
| 기능이 많고 각 기능이 독립적이다 | 기능이 몇 개 없어 계층 폴더로도 한눈에 보인다 |
| 여러 사람이 동시에 다른 기능을 만든다 (충돌이 줄어든다) | 거의 모든 기능이 같은 복잡한 규칙을 공유한다 (그 규칙은 Domain 에 둔다) |

---

## 6. 모듈러 모놀리스 (Modular Monolith)

### 무슨 문제를 푸나

| 구조 | 모양 | 문제 |
| --- | --- | --- |
| **모놀리스** | 실행 파일 하나, 코드는 한 덩어리 | 주문 코드가 상품 테이블을 직접 조회하고, 상품 코드가 주문 서비스를 부르고… 경계가 없어 한 곳을 고치면 어디가 깨질지 모른다 ("진흙 공") |
| **마이크로서비스 (MSA)** | 서비스마다 따로 배포, 네트워크로 통신 | 경계는 확실하지만 배포·모니터링·장애 추적·분산 트랜잭션 비용이 크다. 작은 팀에는 과하다 |
| **모듈러 모놀리스** | **실행 파일은 하나**, 코드는 **모듈마다 확실히 나눔** | 둘의 중간. 배포는 단순하게, 경계는 엄격하게 |

### 구조 예시

```
/src
  /Modules
    /Orders        ← 모듈 하나 = 바운디드 컨텍스트 하나 (1절)
      Orders.Contracts / Orders.Domain / Orders.Application / Orders.Infrastructure   (2절 구조)
    /Catalog
      …
    /Customers
      …
  /SharedKernel    ← 모든 모듈이 쓰는 최소한의 공통 (Money, 기본 예외, 공통 인터페이스)
/WebApi            ← 시작 프로젝트. 모듈들을 DI 에 등록하고 하나의 서버로 띄운다
```

### 모듈 사이의 규칙

모듈러 모놀리스가 그냥 모놀리스로 무너지지 않으려면 지켜야 할 것이 있다.

1. **다른 모듈의 내부(Domain · Infrastructure)를 참조하지 않는다.** 필요하면 그 모듈의 **Contracts** 만 참조한다 (2절의 Contracts 가 여기서 빛난다)
2. **다른 모듈의 테이블을 직접 조회하지 않는다.** 모듈마다 DB 스키마(또는 테이블 접두어)를 나누고, 데이터가 필요하면 그 모듈에 물어본다
3. **모듈끼리는 두 방법으로 대화한다**
   - 지금 답이 필요하면: 상대 모듈의 Contracts 에 있는 요청을 Mediator 로 `Send` (프로세스 안 호출이라 빠르다)
   - 알리기만 하면 되면: 도메인 이벤트 발행 → 관심 있는 모듈이 구독. 예: 주문 모듈이 `OrderPlaced` 를 내면 상품 모듈이 재고를 줄인다

규칙 1번은 2절처럼 프로젝트 참조로 컴파일러가 막을 수 있다. 2·3번은 코드 리뷰나 **아키텍처 테스트**(참조 규칙을 검사하는 단위 테스트. NetArchTest 같은 도구)로 지킨다.

### MSA 로 가는 길

모듈 경계가 이미 깔끔하면, 나중에 트래픽이 몰리는 모듈 하나만 떼어 별도 서비스로 만들 수 있다.
Contracts 를 HTTP API 로, 프로세스 안 이벤트를 메시지 큐로 바꾸면 된다. **처음부터 MSA 로 시작하기보다 모듈러 모놀리스로 시작해 필요한 곳만 떼는** 순서가 요즘 많이 권장된다.

### 언제 쓰나 / 안 쓰나

| 쓴다 | 안 쓴다 |
| --- | --- |
| 도메인이 여러 덩어리(주문·상품·고객·정산)로 나뉘고 팀이 여러 개 | 도메인이 하나뿐인 작은 서비스 |
| MSA 의 운영 비용은 아직 부담스럽다 | 모듈마다 배포 주기·확장 요구가 완전히 달라 이미 따로 배포해야 한다 (그땐 MSA) |

---

## 7. 합쳐 보기 — 요청 하나 따라가기

"주문 생성" 요청이 여섯 패턴을 모두 지나가는 길이다. `01-request-lifecycle.md` 의 그림에 이어 붙여 읽으면 된다.

```
POST /orders  { customerId: 7, items: [...] }
  │
  ▼ WebApi (시작 프로젝트) — 미들웨어 · 인증 · 라우팅
OrdersController.Create
  │  _mediator.Send(new CreateOrderCommand(...))          ← 3. Mediator
  ▼
[파이프라인] 로깅 → CreateOrderValidator → 트랜잭션 시작   ← 3. 공통 처리는 한 번만
  ▼
Orders.Application / Features / CreateOrder / CreateOrderHandler   ← 5. 기능 폴더 · 4. Command
  │  var order = new Order(7); order.AddItem(...); order.Place();
  ▼
Orders.Domain / Order (애그리거트 루트)                    ← 1. 규칙은 여기서만 검사
  │  "빈 주문은 확정 불가", "수량은 1 이상"
  ▼
IOrderRepository (Application 이 정의) → EfOrderRepository (Infrastructure 가 구현)   ← 2. 의존성 역전
  │  SaveChanges → 트랜잭션 커밋 → OrderPlaced 이벤트 발행 → Catalog 모듈이 재고 차감   ← 6. 모듈 간 이벤트
  ▼
OrderResultDto (Orders.Contracts)                          ← 2. 밖으로는 DTO 만
  ▼
201 Created
```

조회(`GET /orders/1001`)는 짧다. `GetOrderQuery` → `GetOrderHandler` 가 `AsNoTracking` + `Select` 로 DTO 를 바로 만든다. 애그리거트도 트랜잭션도 거치지 않는다 (4절).

---

## 8. 언제 무엇을 — 정리

| 상황 | 꺼낼 것 |
| --- | --- |
| 업무 규칙이 여기저기 흩어져 같은 버그가 반복된다 | DDD (애그리거트에 규칙 가두기) |
| 업무 규칙을 DB 없이 테스트하고 싶다 / 저장소가 바뀔 수 있다 | Clean Architecture (의존성 역전) |
| 컨트롤러가 비대하고, 검증·로그를 매번 복붙한다 | Mediator + 파이프라인 |
| 목록 화면이 느린데 원인이 "조회에도 애그리거트를 통째로 불러서" | CQRS 1단계 (조회 전용 핸들러 + Select) |
| 서비스 파일 하나가 2천 줄이다 / 한 기능 고치려고 폴더 다섯 개를 연다 | Vertical Slice |
| 팀이 늘고 도메인이 여러 개인데 MSA 는 부담 | 모듈러 모놀리스 |
| 혼자 만드는 작은 CRUD | 아무것도 안 꺼낸다. `02-layers-and-di.md` 의 세 층이면 충분하다 |

**과설계 경고.** 패턴은 비용이 있다. 파일 수, 간접 호출, 새 사람이 익히는 시간이다.
"이 패턴이 없으면 지금 어떤 문제가 생기나?"에 답할 수 없으면 아직 꺼낼 때가 아니다.

> ❓ 입사 후 확인
> - 모듈 목록과 모듈 경계(바운디드 컨텍스트)는 어떻게 나뉘어 있나
> - 프로젝트 참조 규칙을 무엇으로 강제하나 (프로젝트 참조만? 아키텍처 테스트?)
> - 사내 Mediator 구현의 이름 규칙, 파이프라인 등록 방법, MediatR 과 다른 점
> - CQRS 는 몇 단계까지 쓰나 (읽기 전용 모델이나 별도 읽기 저장소가 있나)
> - 모듈 간 통신은 Contracts 호출과 도메인 이벤트 중 무엇을 주로 쓰나

## 스스로 답해보기

1. 여섯 패턴이 "서로 경쟁하는 선택지가 아니다"라는 말은 무슨 뜻인가? 쇼핑몰 주문 시스템에서 각각이 맡는 부분을 한 줄씩 말해 보라.
2. `order.Status = OrderStatus.Paid;` 가 컴파일되는 코드와 안 되는 코드는 무엇이 다른가? 안 되게 만들면 무엇이 좋아지나?
3. 엔티티와 값 객체를 구별하는 기준은? `Money` 와 `Order` 는 각각 어느 쪽인가?
4. Clean Architecture 에서 `IOrderRepository` 를 Infrastructure 가 아니라 Application(안쪽)에 두는 이유는? "의존성 역전"을 호출 방향과 참조 방향으로 설명해 보라.
5. Contracts 프로젝트가 Domain 을 참조하면 무엇이 새나? 왜 폴더가 아니라 프로젝트로 나누나?
6. 컨트롤러에서 `Send(cmd)` 를 Go to Definition 했더니 라이브러리 내부로 갔다. 실제 처리 코드는 어떻게 찾나?
7. "CQRS 를 도입했다"는 말을 들었을 때 별도 읽기 DB 가 있다고 단정하면 안 되는 이유는? 3단계에서 화면이 감안해야 할 것은?
8. Vertical Slice 에서 기능 사이의 중복을 어디까지 허용하나? 진짜 공통 규칙은 어디로 보내나?
9. 모듈러 모놀리스에서 주문 모듈이 상품 테이블을 직접 `JOIN` 하면 안 되는 이유는? 대신 어떻게 해야 하나?
10. 혼자 만드는 게시판 API 에 여섯 패턴을 전부 넣자는 제안에 어떻게 답하겠나?
