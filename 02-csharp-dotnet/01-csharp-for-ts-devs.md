# TypeScript 개발자를 위한 C#

C# 과 TypeScript 는 **같은 사람(Anders Hejlsberg)이 설계했다.** 그래서 놀랄 만큼 닮아 있다.
`async/await`, 제네릭, 화살표 함수, 구조분해, `?.`, `??` 가 전부 있다. 사실 TS 가 C# 을 따라 만든 쪽이다.

**즉 배울 게 많지 않다. 다른 3가지만 확실히 잡으면 된다.**
1. 값 타입 vs 참조 타입 · struct
2. nullable 참조 타입 (TS 의 strictNullChecks 와 미묘하게 다름)
3. LINQ (이건 배열 메서드와 거의 같다)

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

**`number` 하나가 여러 개로 갈라지는 게 첫 번째 문화 충격이다.**

| 타입 | 크기 | 쓸 곳 |
| --- | --- | --- |
| `int` | 32비트 정수 | 기본 정수 |
| `long` | 64비트 정수 | ID, 타임스탬프 |
| `double` | 부동소수 | 과학 계산 |
| **`decimal`** | 고정소수 | **돈. 반드시.** `double` 로 돈 계산하면 0.1+0.2 문제가 난다 |

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

`* string` 은 참조 타입이지만 **불변(immutable)** 이라 값처럼 행동한다. `s += "a"` 는 새 문자열을 만든다.
반복문에서 문자열을 계속 더하면 O(n²) 이 된다 → `StringBuilder` 를 쓴다.

### record — 데이터 담는 용도의 클래스

```csharp
public record PetDto(Guid Id, string Name, int Age);

var a = new PetDto(id, "코코", 3);
var b = new PetDto(id, "코코", 3);
a == b;                          // true! 값 기반 비교 (class 였으면 false)

var c = a with { Age = 4 };      // 불변 업데이트 — 스프레드 문법과 같은 목적
```

**DTO 는 거의 항상 `record`.** 프론트에서 `{...obj, age: 4}` 하던 걸 `with` 로 한다.

---

## 3. null — 제일 자주 걸리는 곳

```csharp
#nullable enable      // 요즘 프로젝트는 .csproj 에서 기본 활성화

string name = null;    // ⚠️ 경고: null 을 넣을 수 없는 타입
string? name = null;   // ✅ OK
```

TS 의 `strictNullChecks` 와 개념은 같은데 **차이가 하나 있다: C# 의 이건 경고일 뿐 런타임 강제가 아니다.**
컴파일은 되고, 라이브러리 경계나 리플렉션·역직렬화를 통해 `null` 이 들어올 수 있다.

```csharp
var len = name!.Length;        // ! = TS 의 non-null assertion. 똑같이 위험하다
if (name is null) return;      // 패턴 매칭 방식 (권장)
ArgumentNullException.ThrowIfNull(name);   // 인자 검증 한 줄
```

**`NullReferenceException`** 은 C# 에서 가장 흔한 런타임 에러다. JS 의 `Cannot read property of undefined` 와 같은 것.

---

## 4. LINQ — 배열 메서드와 거의 같다

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

### 지연 실행

```csharp
var q = pets.Where(p => p.Age > 3);    // 아직 아무것도 안 함
foreach (var p in q) { ... }           // 여기서 실행
var list = q.ToList();                 // 여기서도 실행 (또 한 번!)
```

`IEnumerable<T>` 는 게으르다. 여러 번 열거하면 **여러 번 실행된다.**
EF Core 에서는 이게 "SQL 이 두 번 나간다"는 뜻이다 → `.ToList()` 로 한 번 굳혀라.

---

## 5. 클래스 문법 — 짧게

```csharp
public class PetService : IPetService        // 상속/구현 둘 다 : 로
{
    // 프로퍼티 — TS 의 get/set 보일러플레이트 없이
    public string Name { get; set; }
    public string Id { get; init; }          // 생성 시에만 설정 가능 (readonly)
    public int Age { get; private set; }     // 외부 읽기, 내부 쓰기

    // primary constructor (C# 12) — 요즘 코드에서 많이 본다
    public PetService(IPetRepository repo) { _repo = repo; }
}

// C# 12 이후: 클래스 선언에 직접
public class PetService(IPetRepository repo) : IPetService
{
    public Task<Pet> GetAsync(int id) => repo.FindAsync(id);   // 표현식 본문
}
```

접근 제어자: `public` / `private` / `protected` / `internal`(같은 어셈블리 내부).
**C# 은 기본이 `private`** 이다. TS 는 기본이 public 이라 반대다.

### 예외

```csharp
try { ... }
catch (DuplicatePetException ex) { ... }     // 타입별로 잡는다 (JS 는 instanceof 로 분기)
catch (Exception ex) when (ex.InnerException is TimeoutException) { ... }   // 필터
finally { ... }
```

C# 은 **예외 타입으로 분기하는 게 정석**이다. 커스텀 예외 클래스를 만들어 서비스 계층에서 던지고,
미들웨어에서 잡아 HTTP 상태코드로 변환하는 구조를 많이 쓴다.

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

### 명명 규칙

| 대상 | 규칙 |
| --- | --- |
| 클래스·메서드·프로퍼티·public 필드 | `PascalCase` |
| 지역 변수·파라미터 | `camelCase` |
| private 필드 | `_camelCase` (밑줄) |
| 인터페이스 | `IPetService` (I 접두사) |
| 비동기 메서드 | `~Async` 접미사 |
| 상수 | `PascalCase` |

---

## 7. 30분 워밍업

새 맥북 세팅 후 이것부터 해라. 읽기만 하는 것보다 훨씬 빠르다.

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

이 60줄을 직접 쳐서 돌려보면 C# 문법의 80% 를 만진 것이다.
