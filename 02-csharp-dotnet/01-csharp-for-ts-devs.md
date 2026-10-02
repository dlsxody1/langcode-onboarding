# TypeScript 개발자를 위한 C#

C# 과 TypeScript 는 **같은 사람(Anders Hejlsberg)이 설계했다.** 그래서 놀랄 만큼 닮아 있다.
`async/await`, 제네릭, 화살표 함수, 구조분해, `?.`, `??` 가 전부 있다. 사실 TS 가 C# 을 따라 만든 쪽이다.

그래서 배울 게 많지 않다. **다른 3가지만 확실히 잡으면 된다.**
1. 값 타입 vs 참조 타입 · struct — 변수에 값 자체가 들어 있나, 값이 있는 곳의 주소가 들어 있나
2. nullable 참조 타입 (TS 의 strictNullChecks 와 미묘하게 다름) — 컴파일러 경고일 뿐 런타임은 막지 않는다
3. LINQ (이건 배열 메서드와 거의 같다) — 다만 실행 시점이 다르다

TS 와 가장 크게 다른 점은 **타입이 런타임에도 살아 있다**는 것이다. TS 의 타입은 컴파일 뒤에 지워지고 JS 만 남는다. C# 의 타입은 실행 중에도 남아 있어서 `int` 변수에 문자열이 들어가는 일이 원천적으로 불가능하다. 대신 `as any` 같은 탈출구도 사실상 없다.

---

## 1. 거의 그대로인 것

```csharp
// 변수 — var 는 JS 의 var 가 아니라 TS 의 타입 추론이다
var name = "carlos";              // string 으로 추론. 재할당은 가능, 타입 변경 불가
string explicitName = "carlos";

// 문자열 보간 — 백틱 대신 $
var msg = $"안녕 {name}, {count + 1}번째";

// 화살표 함수
Func<int, int> double_ = x => x * 2;
var pets = list.Where(p => p.Age > 3).Select(p => p.Name).ToList();

// async/await — 거의 동일
public async Task<Pet> GetAsync(int id)      // Promise<Pet> → Task<Pet>
{
    var pet = await _repo.FindAsync(id);
    return pet;
}
// void 반환 = Task (Promise<void>)

// null 연산자 — 똑같다
var n = pet?.Owner?.Name ?? "이름없음";
pet?.Owner?.Notify();

// 구조분해 (튜플)
var (min, max) = GetRange();

// 스프레드 비슷한 것 — collection expression (C# 12)
int[] a = [1, 2, 3];
int[] b = [..a, 4, 5];

// switch 식 — TS 에 없는데 훨씬 좋다
var label = status switch
{
    "queued"   => "대기 중",
    "running"  => "실행 중",
    _          => "알 수 없음"
};
```

코드에 나온 것 중 처음 보면 낯선 것만 짚는다.

- **`Func<int, int>`** 는 "int 를 받아 int 를 돌려주는 함수"의 타입이다. TS 로 쓰면 `(x: number) => number` 다. 마지막 타입 인자가 반환 타입이다. 반환값이 없는 함수는 `Action<T>` 로 쓴다. 이런 "함수를 담는 타입"을 C# 에서는 **delegate**(델리게이트)라고 부른다.
- **튜플**은 이름 없는 작은 묶음이다. `(int Min, int Max) GetRange()` 처럼 선언해 두면 `var (min, max) = GetRange();` 로 받는다. TS 에서 `[min, max]` 배열을 돌려주고 구조분해하던 것과 같은 용도다.
- **collection expression** 은 C# 12 에서 생긴 대괄호 초기화 문법이다. `[..a, 4, 5]` 의 `..` 이 JS 의 `...` 스프레드다.
- **switch 식**은 값을 돌려주는 `switch` 다. `_` 는 "그 밖의 모든 경우"(default)다. 빠진 경우가 있으면 컴파일러가 경고해 준다.

### async/await — Promise 와 같은 점, 다른 점

`Task<T>` 는 `Promise<T>` 와 거의 같다. `await` 하면 결과가 나오고 실패하면 예외가 던져지며 `async` 메서드는 자동으로 `Task` 를 돌려준다. 이름 끝에 `Async` 를 붙이는 관례만 다르다.

다른 점은 목적이다. 브라우저의 `await` 는 UI 가 멈추지 않게 하는 장치였다. 서버의 `await` 는 DB·HTTP 응답을 기다리는 동안 스레드를 반납해서 **같은 서버가 더 많은 요청을 동시에 받게** 하는 장치다. 자세한 이유는 `01-backend-basics/01-request-lifecycle.md` 5절에서 다뤘다.

실무에서 자주 쓰는 짝은 넷이다.

| TS / 브라우저 | C# | 메모 |
| --- | --- | --- |
| `Promise.all([a, b])` | `await Task.WhenAll(a, b)` | 독립적인 I/O 를 동시에 기다린다 |
| `Promise.race` | `await Task.WhenAny(...)` | 먼저 끝난 하나 |
| `AbortController` / `AbortSignal` | `CancellationTokenSource` / `CancellationToken` | 진행 중인 작업 취소 |
| `setTimeout` 으로 기다리기 | `await Task.Delay(100, ct)` | 취소 토큰을 같이 넘길 수 있다 |

**CancellationToken** 은 `fetch(url, { signal })` 에 넘기던 `AbortSignal` 과 같은 발상이다. "이제 그만해도 된다"는 신호를 담은 작은 값이다. 받은 메서드는 그 신호를 아래 호출(DB 쿼리, HTTP 호출)에 계속 넘겨 준다. 그래서 async 메서드는 보통 마지막 파라미터로 `CancellationToken ct` 를 받는다. ASP.NET Core 에서 이 토큰이 어디서 오는지는 `02-csharp-dotnet/02-aspnet-core.md` 2절에서 본다.

```csharp
public async Task<(Stock, Price)> GetStockAndPriceAsync(Guid id, CancellationToken ct)
{
    var stockTask = _stock.GetAsync(id, ct);    // 시작만 하고 기다리지 않는다
    var priceTask = _price.GetAsync(id, ct);    // 동시에 시작

    await Task.WhenAll(stockTask, priceTask);   // 둘 다 끝날 때까지
    return (stockTask.Result, priceTask.Result); // 이미 끝났으므로 .Result 가 안전하다
}
```

각 호출이 200ms 라면 순서대로 `await` 할 때 400ms, `WhenAll` 이면 약 200ms 다.
단, **같은 `DbContext` 하나로 두 쿼리를 `WhenAll` 하면 안 된다.** EF Core 의 DbContext 는 동시에 두 작업을 받지 못한다. (→ `02-csharp-dotnet/03-ef-core.md` 8절)

### 타입 대조표

| TypeScript | C# |
| --- | --- |
| `string` | `string` |
| `number` | `int` / `long` / `double` / `decimal` ← **구분해야 한다** |
| `boolean` | `bool` |
| `T[]` | `List<T>` (가변) / `T[]` (고정) / `IEnumerable<T>` (열거만) |
| `Record<K,V>` / 객체 | `Dictionary<K,V>` |
| `Promise<T>` | `Task<T>` |
| `Promise<void>` | `Task` |
| `T \| null` | `T?` |
| `interface` | `interface` (멤버만) / `record` (데이터) |
| `type X = {...}` | `record` 또는 `class` |
| `unknown` | `object` |
| `any` | `dynamic` (쓰지 마라) |
| `never` | — |

표에서 헷갈리기 쉬운 줄을 풀어 둔다.

- **`IEnumerable<T>`** 는 "하나씩 꺼내 볼 수 있는 것"이라는 가장 넓은 타입이다. TS 의 `Iterable<T>` 와 같다. 길이도 모르고 인덱스 접근도 안 된다. 메서드 파라미터를 `IEnumerable<T>` 로 받으면 배열이든 `List` 든 다 넘길 수 있어서 자주 보인다.
- **C# 의 `interface` 는 TS 처럼 "데이터 모양"을 적는 용도로 잘 안 쓴다.** 메서드 목록(계약)을 적는 용도다. 데이터 모양은 `record` 나 `class` 로 만든다. TS 처럼 모양이 같으면 통과하는 구조적 타이핑도 없다. `IPetService` 를 구현한다고 `: IPetService` 로 직접 선언한 클래스만 그 타입으로 인정된다.
- **`dynamic`** 은 컴파일 타임 타입 검사를 끄는 타입이다. 오타가 런타임 예외로 바뀐다. JSON 을 다룰 때 쓰고 싶어지는데 그럴 때는 `JsonElement` 나 전용 `record` 를 만든다.

**`number` 하나가 여러 개로 갈라지는 게 첫 번째 문화 충격이다.**

| 타입 | 크기 | 쓸 곳 |
| --- | --- | --- |
| `int` | 32비트 정수 | 기본 정수 |
| `long` | 64비트 정수 | ID, 타임스탬프 |
| `double` | 부동소수 | 과학 계산 |
| **`decimal`** | 고정소수 | **돈. 반드시.** `double` 로 돈 계산하면 0.1+0.2 문제가 난다 |

숫자로 보면 차이가 바로 보인다.

```csharp
Console.WriteLine(0.1 + 0.2);      // 0.30000000000000004  (double)
Console.WriteLine(0.1m + 0.2m);    // 0.3                  (decimal — 숫자 뒤 m 이 decimal 리터럴)
```

`double` 은 2진수로 소수를 저장해서 0.1 을 정확히 표현하지 못한다. JS 의 `number` 도 `double` 이라 같은 문제가 있었다. `decimal` 은 10진수로 저장해서 이 오차가 없다. 1원짜리 오차라도 정산 금액이 맞지 않으면 사고이므로 금액 필드는 무조건 `decimal` 이다.

`int` 는 약 ±21억까지만 담는다. 조회수 합계나 바이트 크기처럼 커질 수 있는 값은 `long` 을 쓴다. 범위를 넘으면 예외 없이 음수로 뒤집히는(overflow) 것이 기본 동작이라 더 위험하다.

---

## 2. 값 타입 vs 참조 타입 — JS 에 없던 개념

```csharp
// 값 타입 (struct): int, bool, double, DateTime, Guid, 사용자 정의 struct
int a = 5;
int b = a;      // 복사됨
b = 10;         // a 는 여전히 5

// 참조 타입 (class): string*, 배열, List, 사용자 정의 class
var p1 = new Pet { Name = "코코" };
var p2 = p1;                  // 같은 객체를 가리킴
p2.Name = "루비";             // p1.Name 도 "루비"
```

JS 에서 원시값과 객체가 다르게 동작하던 것과 같은 이야기인데, C# 은 **내가 만든 타입도 값 타입으로 만들 수 있다.**

차이를 한 문장으로 줄이면 "변수에 무엇이 들어 있나"다. 값 타입 변수에는 값 자체가 들어 있어서 대입하면 값이 통째로 복사된다. 참조 타입 변수에는 객체가 있는 곳의 주소가 들어 있어서 대입하면 주소만 복사되고 두 변수가 같은 객체를 본다.

| | 값 타입 (`struct`) | 참조 타입 (`class`) |
| --- | --- | --- |
| 대입하면 | 값 전체가 복사된다 | 주소만 복사된다 (같은 객체를 공유) |
| 기본값 | `0`, `false` 처럼 "빈 값" | `null` |
| `null` 이 될 수 있나 | 기본은 안 된다. `int?` 처럼 써야 한다 | 된다 |
| 예 | `int`, `bool`, `decimal`, `DateTime`, `Guid` | `string`, 배열, `List<T>`, 직접 만든 `class` |
| 직접 만들 때 | 작고 불변인 값 묶음 (`Money`, 좌표) | 그 밖의 거의 전부 |

`Guid` 와 `DateTime` 이 값 타입이라는 점은 실무에서 의미가 있다. `Guid id` 파라미터는 `null` 이 될 수 없고 아무것도 안 넣으면 `00000000-0000-0000-0000-000000000000`(`Guid.Empty`)이 된다. API 요청에서 ID 를 빠뜨렸을 때 `null` 이 아니라 이 값이 들어오는 이유다.

직접 값 타입을 만들 일은 많지 않다. 만든다면 이런 모양이다.

```csharp
public readonly record struct Money(decimal Amount, string Currency);   // 작고, 불변이고, 값으로 비교된다
```

`* string` 은 참조 타입이지만 **불변(immutable)** 이라 값처럼 행동한다. `s += "a"` 는 새 문자열을 만든다.
불변이란 한 번 만든 뒤에는 내용을 바꿀 수 없다는 뜻이다. JS 의 문자열도 같다.
그래서 반복문에서 문자열을 계속 더하면 매번 전체를 새로 복사하므로 O(n²) 이 된다 → `StringBuilder` 를 쓴다.

```csharp
var sb = new StringBuilder();
foreach (var line in lines) sb.Append(line).Append('\n');   // 내부 버퍼에 이어 붙인다
var text = sb.ToString();                                    // 마지막에 한 번만 문자열로
```

줄이 몇 개 정도면 `+` 로 충분하다. 수천 번 도는 루프에서만 차이가 난다. 컬렉션을 이어 붙일 때는 `string.Join(", ", names)` 이 가장 간단하다.

### record — 데이터 담는 용도의 클래스

```csharp
public record PetDto(Guid Id, string Name, int Age);

var a = new PetDto(id, "코코", 3);
var b = new PetDto(id, "코코", 3);
a == b;                          // true! 값 기반 비교 (class 였으면 false)

var c = a with { Age = 4 };      // 불변 업데이트 — 스프레드 문법과 같은 목적
```

**DTO 는 거의 항상 `record`.** 프론트에서 `{...obj, age: 4}` 하던 걸 `with` 로 한다.

**DTO**(Data Transfer Object)는 계층이나 네트워크 경계를 넘어 데이터를 실어 나르기만 하는 객체다. API 요청·응답의 JSON 모양이 곧 DTO 다. 로직이 없고 값만 있으므로 `record` 가 딱 맞는다.

`public record PetDto(Guid Id, string Name, int Age);` 한 줄을 쓰면 컴파일러가 다음을 자동으로 만들어 준다.

| 자동 생성되는 것 | 효과 |
| --- | --- |
| 생성자와 `init` 프로퍼티 3개 | `new PetDto(id, "코코", 3)` 로 만들고 만든 뒤에는 못 바꾼다 |
| 값 기반 `==` / `Equals` / `GetHashCode` | 필드 값이 모두 같으면 같은 것으로 본다 |
| `with` 복사 | 일부만 바꾼 새 객체 |
| `ToString()` | `PetDto { Id = ..., Name = 코코, Age = 3 }` 처럼 찍혀서 로그로 보기 좋다 |
| 구조분해 | `var (id, name, age) = dto;` |

반대로 **EF Core 엔티티는 `record` 가 아니라 `class` 로 만든다.** EF Core 는 가져온 객체의 프로퍼티를 직접 바꾸는 방식으로 변경을 추적하므로 엔티티가 가변이어야 하고 같은 행인지는 값이 아니라 기본 키로 판단해야 하기 때문이다. `labs/lab1-dotnet-crud/reference/Domain.cs` 가 정확히 이렇게 나뉘어 있다.

---

## 3. null — 제일 자주 걸리는 곳

```csharp
#nullable enable      // 요즘 프로젝트는 .csproj 에서 기본 활성화

string name = null;    // ⚠️ 경고: null 을 넣을 수 없는 타입
string? name = null;   // ✅ OK
```

이 기능의 이름이 **nullable 참조 타입**(Nullable Reference Types)이다. 켜 두면 `string` 은 "null 이 아님", `string?` 은 "null 일 수 있음"으로 읽힌다. 새 프로젝트 템플릿은 `.csproj` 에 `<Nullable>enable</Nullable>` 이 이미 들어 있다. 오래된 코드베이스는 꺼져 있을 수 있으니 처음에 확인한다.

TS 의 `strictNullChecks` 와 개념은 같은데 **차이가 하나 있다: C# 의 이건 경고일 뿐 런타임 강제가 아니다.**
컴파일은 되고 라이브러리 경계나 리플렉션·역직렬화를 통해 `null` 이 들어올 수 있다.
예를 들어 JSON 에서 `"name"` 필드가 빠진 요청이 오면 `string Name` 으로 선언한 프로퍼티에도 `null` 이 들어간다. 그래서 외부에서 들어오는 값은 검증(→ `02-csharp-dotnet/02-aspnet-core.md` 7절)으로 한 번 더 막는다.

```csharp
var len = name!.Length;        // ! = TS 의 non-null assertion. 똑같이 위험하다
if (name is null) return;      // 패턴 매칭 방식 (권장)
ArgumentNullException.ThrowIfNull(name);   // 인자 검증 한 줄
```

`?` 가 붙는 두 경우는 속이 다르다. 헷갈리기 쉬워서 표로 둔다.

| 표기 | 무엇 | 런타임에 |
| --- | --- | --- |
| `int?`, `Guid?`, `DateOnly?` | 값 타입의 nullable. 실제로 `Nullable<int>` 라는 다른 타입이 된다 | 진짜로 `null` 을 담는 상자. `.HasValue`, `.Value` 가 있다 |
| `string?`, `Pet?` | 참조 타입의 nullable 표시 | 아무 차이 없다. 컴파일러 경고용 표시일 뿐이다 |

EF Core 엔티티에서 `public Owner Owner { get; set; } = null!;` 같은 줄을 자주 본다. "지금은 비어 있지만 EF 가 채워 줄 테니 경고를 끄겠다"는 관용구다. `!` 를 쓴 만큼 실제로 채워지는지는 사람이 책임진다.

> EF Core 는 이 표시를 DB 스키마에도 쓴다. `string Name` 이면 `NOT NULL`, `string? Name` 이면 NULL 허용 컬럼이 된다. (→ `07-db-infra/01-relational-basics.md` 6절)

**`NullReferenceException`** 은 C# 에서 가장 흔한 런타임 에러다. JS 의 `Cannot read property of undefined` 와 같은 것.

---

## 4. LINQ — 배열 메서드와 거의 같다

**LINQ**(Language Integrated Query)는 컬렉션을 거르고 바꾸고 모으는 메서드 묶음이다. `using System.Linq;` 를 하면 배열·`List`·DB 쿼리 모두에 같은 메서드가 붙는다. 같은 `Where` 가 메모리의 리스트에서는 반복문으로, EF Core 에서는 SQL `WHERE` 로 실행된다는 점이 핵심이다.

```csharp
using System.Linq;

var names = pets
    .Where(p => p.Age > 3)             // filter
    .OrderByDescending(p => p.Age)     // sort
    .Select(p => p.Name)               // map
    .Take(10)                          // slice(0,10)
    .ToList();

pets.Any(p => p.Age > 10);             // some
pets.All(p => p.Age > 0);              // every
pets.First(p => p.Id == id);           // find → 없으면 예외!
pets.FirstOrDefault(p => p.Id == id);  // find → 없으면 null
pets.Sum(p => p.Age);
pets.GroupBy(p => p.Species);
pets.Aggregate((a, b) => ...);         // reduce
```

| JS | LINQ | 주의 |
| --- | --- | --- |
| `.filter()` | `.Where()` | |
| `.map()` | `.Select()` | **이름이 반대 같아서 헷갈린다** |
| `.find()` | `.FirstOrDefault()` | `.First()` 는 없으면 **예외를 던진다** |
| `.some()` | `.Any()` | |
| `.every()` | `.All()` | |
| `.reduce()` | `.Aggregate()` | |
| `.slice(0,n)` | `.Take(n)` | |
| `.flat()` | `.SelectMany()` | |

**`First()` vs `FirstOrDefault()` 구분이 실무에서 진짜 중요하다.** 전자는 `InvalidOperationException`,
후자는 `null`. 대부분 `FirstOrDefault` 를 쓰고 null 체크한다. `Single()` 은 "정확히 하나여야 함"을 강제한다.

넷을 나란히 놓으면 이렇다.

| 결과가 0개일 때 | 1개일 때 | 2개 이상일 때 |
| --- | --- | --- |
| `First` → 예외 | 그것 | 첫 번째 |
| `FirstOrDefault` → `null` | 그것 | 첫 번째 |
| `Single` → 예외 | 그것 | **예외** |
| `SingleOrDefault` → `null` | 그것 | **예외** |

`Single` 은 "두 개 이상이면 데이터가 잘못된 것"이라고 선언하는 셈이다. 이메일처럼 유일해야 하는 값으로 찾을 때 쓴다. 값 타입 컬렉션에서 `FirstOrDefault` 가 못 찾으면 `null` 이 아니라 `0` 같은 기본값이 나온다는 점도 기억해 둔다.

코드베이스에 따라 SQL 처럼 생긴 **쿼리 문법**을 만날 수도 있다. 위 메서드 문법과 같은 것을 다르게 쓴 것뿐이다.

```csharp
var names = from p in pets
            where p.Age > 3
            orderby p.Age descending
            select p.Name;
```

### 지연 실행

```csharp
var q = pets.Where(p => p.Age > 3);    // 아직 아무것도 안 함
foreach (var p in q) { ... }           // 여기서 실행
var list = q.ToList();                 // 여기서도 실행 (또 한 번!)
```

`IEnumerable<T>` 는 게으르다. 여러 번 열거하면 **여러 번 실행된다.**
EF Core 에서는 이게 "SQL 이 두 번 나간다"는 뜻이다 → `.ToList()` 로 한 번 굳혀라.

**지연 실행**(deferred execution)은 "무엇을 할지 적어 두기만 하고 결과를 꺼낼 때 비로소 실행한다"는 동작이다. JS 배열의 `filter` 는 호출 즉시 새 배열을 만든다. LINQ 의 `Where` 는 "나중에 이 조건으로 거를 것"이라는 계획만 돌려준다. 실제 실행은 `foreach`, `ToList()`, `Count()`, `First()` 처럼 값을 꺼내는 순간에 일어난다.

| 줄 | 이 시점에 일어나는 일 |
| --- | --- |
| `var q = pets.Where(...)` | 계획만 만든다. 필터는 한 번도 안 돌았다 |
| `foreach (var p in q)` | 처음부터 끝까지 돌며 필터 실행 (1회차) |
| `q.ToList()` | 다시 처음부터 필터 실행 (2회차). 결과를 리스트로 굳힌다 |
| `list.Count` | 이미 굳힌 리스트라 다시 실행하지 않는다 |

이 성질은 단점만 있는 게 아니다. 실행 전까지 조건을 계속 덧붙일 수 있어서 검색 필터를 조건부로 쌓을 때 편하다. EF Core 에서는 쌓인 조건 전체가 SQL 한 문장으로 번역된다. (→ `02-csharp-dotnet/03-ef-core.md` 3-2절 ⑧)

---

## 5. 클래스 문법 — 짧게

```csharp
public class PetService : IPetService        // 상속/구현 둘 다 : 로
{
    private readonly IPetRepository _repo;

    // 프로퍼티 — TS 의 get/set 보일러플레이트 없이
    public string Name { get; set; }
    public string Id { get; init; }          // 생성 시에만 설정 가능 (readonly)
    public int Age { get; private set; }     // 외부 읽기, 내부 쓰기

    // 일반 생성자 — 오래된 코드는 대부분 이 모양이다
    public PetService(IPetRepository repo) { _repo = repo; }
}

// primary constructor (C# 12) — 요즘 코드에서 많이 본다. 클래스 선언에 직접
public class PetService(IPetRepository repo) : IPetService
{
    public Task<Pet> GetAsync(int id) => repo.FindAsync(id);   // 표현식 본문
}
```

몇 가지 용어를 풀어 둔다.

- **프로퍼티**는 바깥에서는 필드처럼 읽고 쓰지만 실제로는 get/set 메서드인 멤버다. TS 클래스의 `get name()` / `set name(v)` 를 한 줄로 줄인 것이다. C# 에서는 public 데이터를 필드가 아니라 거의 항상 프로퍼티로 노출한다.
- **`init`** 은 객체를 만들 때(`new Pet { Id = "..." }`)만 값을 넣을 수 있고 그 뒤로는 못 바꾸게 한다. TS 의 `readonly` 프로퍼티와 비슷하다. 반드시 채워야 하는 값이라면 `public required string Id { get; init; }` 처럼 `required` 를 붙인다. 빠뜨리면 컴파일 에러가 난다.
- **primary constructor** 는 생성자 파라미터를 클래스 이름 옆에 바로 적는 문법이다. 파라미터(`repo`)가 클래스 전체에서 보인다. DI 로 의존성을 받는 서비스 클래스가 이 덕분에 아주 짧아졌다.
- **표현식 본문**(`=>`)은 본문이 한 줄일 때 `{ return ...; }` 를 생략하는 문법이다. JS 화살표 함수의 중괄호 생략과 같다.

접근 제어자: `public` / `private` / `protected` / `internal`(같은 어셈블리 내부).
**C# 은 기본이 `private`** 이다. TS 는 기본이 public 이라 반대다.
어셈블리는 프로젝트 하나를 빌드해서 나온 `.dll` 이다. `internal` 은 "이 프로젝트 안에서만 쓰고 다른 프로젝트에는 노출하지 않는다"는 뜻이다. 클래스 자체에 접근 제어자를 안 쓰면 기본값은 `internal` 이다.

### `using` — 다 쓴 자원을 바로 돌려준다

DB 연결, 파일 핸들, HTTP 응답 스트림처럼 운영체제 자원을 붙드는 객체는 `IDisposable` 을 구현한다. 다 쓰면 `Dispose()` 를 불러 자원을 돌려줘야 한다. 이걸 빼먹지 않게 해 주는 문법이 `using` 이다.

```csharp
using var stream = File.OpenRead(path);                       // 블록(메서드)이 끝나면 자동으로 Dispose
await using var tx = await db.Database.BeginTransactionAsync(ct);   // 비동기 정리가 필요한 것은 await using
```

JS 의 `try { ... } finally { file.close() }` 를 컴파일러가 대신 써 주는 것이다. 맨 위의 `using System.Linq;` 와는 이름만 같고 전혀 다른 기능이다. 그쪽은 TS 의 `import` 다.

ASP.NET Core 에서 DI 컨테이너가 만들어 준 객체(`DbContext` 등)는 컨테이너가 알아서 `Dispose` 하므로 직접 `using` 하지 않는다. 내가 `new` 로 만든 것만 내가 정리한다.

### 예외

```csharp
try { ... }
catch (DuplicatePetException ex) { ... }     // 타입별로 잡는다 (JS 는 instanceof 로 분기)
catch (Exception ex) when (ex.InnerException is TimeoutException) { ... }   // 필터
finally { ... }
```

C# 은 **예외 타입으로 분기하는 게 정석**이다. 커스텀 예외 클래스를 만들어 서비스 계층에서 던지고,
미들웨어에서 잡아 HTTP 상태코드로 변환하는 구조를 많이 쓴다.

`when (...)` 은 **예외 필터**다. 타입이 맞더라도 조건이 참일 때만 잡는다. `InnerException` 은 예외가 다른 예외를 감싸고 있을 때 안쪽 원인을 가리킨다. JS 의 `error.cause` 와 같다.

일부 팀은 "중복 이름"처럼 예상 가능한 실패를 예외 대신 `Result<T>` 같은 반환값으로 돌려준다. 두 방식의 차이는 `02-csharp-dotnet/02-aspnet-core.md` 6절에서 비교한다.

---

## 6. TS 사람이 실제로 걸려 넘어지는 것들

| 함정 | 설명 |
| --- | --- |
| `==` 가 안전하다 | JS 와 달리 타입 강제 변환이 없다. `===` 가 아예 없다 |
| 문자열 비교 | `==` 로 내용 비교됨 (string 은 특별 취급). 다른 참조 타입은 참조 비교 |
| `First()` 가 던진다 | `FirstOrDefault()` 를 쓰는 습관 |
| `IEnumerable` 재열거 | 두 번 돌리면 두 번 실행. `.ToList()` 로 굳혀라 |
| `async void` | **절대 쓰지 마라.** 예외를 잡을 수 없어 프로세스가 죽는다. 이벤트 핸들러 외엔 항상 `async Task` |
| `.Result` / `.Wait()` | 데드락의 근원. **끝까지 `await`** |
| `decimal` 안 쓰고 `double` | 돈 계산이 틀린다 |
| 대문자 시작 | 메서드·프로퍼티가 `PascalCase`. JSON 직렬화 시 camelCase 변환 설정 확인 |

```csharp
// ❌ 이걸 보면 고쳐라
public async void DoWork() { await ... }      // async void
var result = SomeAsync().Result;              // 동기 블로킹
```

### 왜 `async void` 와 `.Result` 가 위험한가

**`async void`** 메서드는 `Task` 를 돌려주지 않는다. 그 안에서 예외가 나면 예외를 담아 호출자에게 전할 `Task` 가 없다. 그래서 호출한 쪽의 `try/catch` 로 잡을 수 없고 처리되지 않은 예외가 되어 프로세스가 죽는다. 버튼 클릭 핸들러처럼 시그니처가 `void` 로 정해진 이벤트 핸들러에만 예외로 허용된다.

**`.Result` / `.Wait()` / `.GetAwaiter().GetResult()`** 는 비동기 작업이 끝날 때까지 현재 스레드를 붙잡고 기다린다. 이걸 **sync-over-async**(비동기 코드를 동기로 기다리기)라고 부른다.

- WinForms·WPF 같은 UI 앱이나 구 ASP.NET(.NET Framework)에서는 **데드락**이 난다. 기다리는 스레드가 바로 작업을 마무리할 스레드라서 서로를 영원히 기다린다.
- ASP.NET Core 에서는 데드락까지는 잘 안 가지만 **스레드 풀 고갈**이 생긴다. 요청 100개가 각자 스레드를 하나씩 붙잡고 기다리면 새 요청을 받을 스레드가 없어서 서버 전체가 느려진다. 평소엔 멀쩡하다가 트래픽이 몰릴 때만 터져서 원인을 찾기 어렵다.

해결은 하나다. 호출 경로 전체를 `async` 로 만들고 끝까지 `await` 한다("async all the way"). 위의 `Task.WhenAll` 예제처럼 이미 끝난 `Task` 의 `.Result` 를 읽는 것만 예외적으로 안전하다.

> 라이브러리 코드에서 `await x.ConfigureAwait(false)` 를 볼 수 있다. "await 뒤에 원래 스레드 문맥으로 돌아오지 않아도 된다"는 표시로, UI 앱에서 쓰일 수 있는 라이브러리가 데드락을 피하려고 붙인다. ASP.NET Core 앱 코드에는 돌아갈 문맥 자체가 없으므로 붙이지 않아도 된다.

### 명명 규칙

| 대상 | 규칙 |
| --- | --- |
| 클래스·메서드·프로퍼티·public 필드 | `PascalCase` |
| 지역 변수·파라미터 | `camelCase` |
| private 필드 | `_camelCase` (밑줄) |
| 인터페이스 | `IPetService` (I 접두사) |
| 비동기 메서드 | `~Async` 접미사 |
| 상수 | `PascalCase` |

C# 프로퍼티는 `PascalCase`(`OwnerName`)지만 ASP.NET Core 는 JSON 으로 내보낼 때 기본으로 camelCase(`ownerName`)로 바꿔 준다. 프론트에서 받는 필드명이 이상하면 이 설정(`JsonSerializerOptions`)을 먼저 본다.

---

## 7. 30분 워밍업

새 맥북 세팅 후 이것부터 해라. 읽기만 하는 것보다 훨씬 빠르다. (Windows 라면 PowerShell 에서 임의의 빈 폴더를 만들어 같은 명령을 쓰면 된다)

```bash
mkdir /tmp/cs-warmup && cd /tmp/cs-warmup
dotnet new console
```

`Program.cs` 에 넣고 `dotnet run`:

```csharp
record Pet(string Name, int Age, string Species);

var pets = new List<Pet>
{
    new("코코", 3, "dog"), new("루비", 7, "dog"), new("나비", 2, "cat")
};

// 1. LINQ
var oldDogs = pets.Where(p => p.Species == "dog" && p.Age > 5).Select(p => p.Name).ToList();
Console.WriteLine(string.Join(", ", oldDogs));

// 2. 그룹핑
foreach (var g in pets.GroupBy(p => p.Species))
    Console.WriteLine($"{g.Key}: {g.Count()}마리, 평균 {g.Average(p => p.Age):F1}살");

// 3. record 동등성과 with
var a = new Pet("코코", 3, "dog");
Console.WriteLine(a == pets[0]);              // true
Console.WriteLine(a with { Age = 4 });

// 4. null 처리
Pet? missing = pets.FirstOrDefault(p => p.Name == "없음");
Console.WriteLine(missing?.Name ?? "못 찾음");

// 5. async
async Task<int> SlowAdd(int x) { await Task.Delay(100); return x + 1; }
Console.WriteLine(await SlowAdd(41));

// 6. switch 식 + 패턴 매칭
string Describe(Pet p) => p switch
{
    { Age: < 1 }            => "아기",
    { Age: > 10 }           => "노령",
    { Species: "cat" }      => "고양이",
    _                       => "성견"
};
pets.ForEach(p => Console.WriteLine($"{p.Name}: {Describe(p)}"));
```

이 코드를 직접 쳐서 돌려보면 C# 문법의 80% 를 만진 것이다.

파일 맨 위에 `class Program` 도 `static void Main` 도 없는데 실행되는 것은 **top-level statements**(최상위 문) 덕분이다. 컴파일러가 이 코드를 `Program` 클래스의 `Main` 메서드로 감싸 준다. ASP.NET Core 의 `Program.cs` 도 같은 방식으로 쓰여 있다. `List`, `Console` 을 `using` 없이 쓰는 것은 **implicit usings**(자주 쓰는 네임스페이스 자동 import) 덕분이다.

6번의 `{ Age: < 1 }` 은 **프로퍼티 패턴**이다. "Age 프로퍼티가 1 미만인 객체"와 맞는지 검사한다. 위에서부터 차례로 검사해서 처음 맞는 줄을 쓴다. 그래서 7살 고양이는 "고양이", 12살 고양이는 "노령"이 된다.

---

## 스스로 답해보기

1. `decimal` 대신 `double` 로 금액 합계를 내면 어떤 일이 생기나? `0.1 + 0.2` 로 설명해 보라.
2. `Guid OwnerId` 가 들어 있는 요청에서 클라이언트가 `ownerId` 를 빠뜨리면 서버에는 어떤 값이 들어오나?
3. `string Name` 으로 선언했는데 런타임에 `NullReferenceException` 이 났다. nullable 참조 타입을 켰는데도 왜 가능한가?
4. `var q = pets.Where(...)` 뒤에 `q.Count()` 와 `q.ToList()` 를 차례로 부르면 필터는 몇 번 실행되나?
5. 엔티티는 `class`, DTO 는 `record` 로 만드는 이유는 무엇인가?
6. ASP.NET Core 컨트롤러 안에서 `SomeAsync().Result` 를 쓰면 평소에는 괜찮다가 트래픽이 몰릴 때 문제가 된다. 왜인가?
