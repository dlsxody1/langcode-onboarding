# C# 문법 — 시험용 정리

`01-csharp-for-ts-devs.md` 는 TS 와 비교하며 읽는 입문이다. 이 문서는 **시험에 나올 만한 문법을 한 곳에 모은 것**이다.
최신 C# 12 · 13 · 14 (.NET 8 · 9 · 10) 에서 바뀐 것까지 포함한다.

> 공식 문서: [C# 둘러보기](https://learn.microsoft.com/ko-kr/dotnet/csharp/tour-of-csharp/overview) ·
> [C# 언어 버전 기록](https://learn.microsoft.com/ko-kr/dotnet/csharp/whats-new/)

---

## 1. 값 타입 vs 참조 타입

| | 값 타입 | 참조 타입 |
| --- | --- | --- |
| 예 | `int` `double` `bool` `char` `struct` `enum` `DateTime` | `class` `string` `record` `interface` `delegate` 배열 |
| 대입하면 | **복사** | **같은 객체를 가리킴** |
| 기본값 | 0 / false | null |
| 저장 위치 | 보통 스택 (필드면 객체 안) | 힙 |

```csharp
var a = new Point { X = 1 }; // struct
var b = a; b.X = 9;           // a.X 는 그대로 1

var c = new Person { Name = "kim" }; // class
var d = c; d.Name = "lee";            // c.Name 도 "lee"
```

- `string` 은 참조 타입이지만 **불변(immutable)** 이라 값처럼 행동한다. 바꾸면 새 문자열이 생긴다.
- **박싱**: 값 타입을 `object` 로 담으면 힙에 상자가 생긴다. **언박싱**은 그 반대. 비용이 크다.
- `ref` · `out` · `in` 은 인자를 **참조로** 넘긴다.

| 키워드 | 의미 |
| --- | --- |
| `ref` | 읽고 쓴다. 호출 전에 초기화되어 있어야 한다 |
| `out` | 메서드가 **반드시 채워서** 돌려준다. 호출 전 초기화 불필요 |
| `in` | 읽기 전용 참조. 큰 struct 복사 비용을 피한다 |

---

## 2. null 처리

C# 8 부터 nullable 참조 타입이 있다. `string` 은 null 불가, `string?` 은 null 가능이라고 **컴파일러가 경고**한다 (런타임은 그대로).

| 연산자 | 이름 | 예 |
| --- | --- | --- |
| `?.` | null 조건부 | `user?.Name` — user 가 null 이면 결과도 null |
| `??` | null 병합 | `name ?? "익명"` — null 이면 오른쪽 |
| `??=` | null 병합 대입 | `cache ??= new()` — null 일 때만 대입 |
| `!` | null 허용 (경고 끄기) | `user!.Name` — 내가 책임진다는 뜻. 런타임에 터질 수 있다 |
| `?.=` | null 조건부 대입 | `user?.Name = "x"` (C# 14) |

```csharp
int? n = null;            // Nullable<int>
int v = n ?? 0;           // 0
bool has = n.HasValue;    // false
int bad = n.Value;        // InvalidOperationException
```

`int?` 는 값 타입에 null 을 허용하는 `Nullable<int>` 다. `string?` 은 **타입이 아니라 컴파일러 주석**이라 구조가 다르다.

---

## 3. 클래스 · 프로퍼티 · 생성자

### 프로퍼티

```csharp
public class User
{
    public string Name { get; set; } = "";          // 자동 구현
    public int Age { get; init; }                    // 초기화할 때만 대입 가능
    public required string Email { get; init; }      // 만들 때 반드시 지정 (C# 11)
    public string Display => $"{Name} ({Age})";     // 식 본문 — 읽기 전용
}
```

| 접근자 | 의미 |
| --- | --- |
| `get; set;` | 언제든 읽고 쓴다 |
| `get; init;` | 객체 초기화 때만 쓴다. 이후 **불변** |
| `get; private set;` | 클래스 안에서만 바꾼다 |
| `required` | `new User { }` 에서 빠뜨리면 컴파일 에러 |

### 기본 생성자 (primary constructor)

C# 12 에서 **모든 class · struct** 에 허용됐다 (record 는 원래 있었다).

```csharp
public class OrderService(IOrderRepo repo, ILogger<OrderService> log)
{
    public Order? Get(int id) => repo.Find(id);   // 파라미터를 본문에서 바로 쓴다
}
```

- 파라미터는 **필드가 아니라 캡처된 값**이다. record 와 달리 프로퍼티가 자동으로 생기지 않는다.
- DI 로 의존성을 받는 서비스에 널리 쓴다.

### 접근 제한자

| 키워드 | 접근 범위 |
| --- | --- |
| `public` | 어디서나 |
| `internal` | **같은 어셈블리** (클래스 기본값) |
| `private` | 같은 타입 안 (멤버 기본값) |
| `protected` | 같은 타입 + 파생 클래스 |
| `private protected` | 같은 어셈블리 안의 파생 클래스 |
| `protected internal` | 같은 어셈블리 **또는** 파생 클래스 |
| `file` | 같은 **파일** 안 (C# 11) |

### 상속과 다형성

| 키워드 | 의미 |
| --- | --- |
| `virtual` | 파생 클래스가 재정의할 수 있다 |
| `override` | 재정의한다 |
| `abstract` | 구현이 없다. 파생 클래스가 **반드시** 구현. 인스턴스 못 만든다 |
| `sealed` | 더 상속·재정의 못 한다 |
| `new` | 이름만 숨긴다 (다형성 안 됨). 거의 쓰지 않는다 |

**자바와 다르게** C# 메서드는 기본이 **비가상(non-virtual)** 이다. `virtual` 을 붙여야 재정의된다.

### 인터페이스 vs 추상 클래스

| | 인터페이스 | 추상 클래스 |
| --- | --- | --- |
| 다중 | 여러 개 구현 가능 | **하나만** 상속 |
| 상태(필드) | 없다 | 있다 |
| 기본 구현 | 가능 (C# 8+, 기본 인터페이스 메서드) | 가능 |
| 용도 | "할 수 있다" 계약 · DI | "~의 한 종류" + 공통 코드 |

---

## 4. record · struct · class 고르기

```csharp
public record Person(string Name, int Age);           // 불변 + 값 동등성 + with
var p2 = p1 with { Age = 31 };                         // 복사하면서 한 칸만 바꾼다

public readonly record struct Point(int X, int Y);     // 값 타입 record
```

| | class | record | struct |
| --- | --- | --- | --- |
| 동등성 | **참조** | **값** (모든 프로퍼티) | 값 (기본은 느림) |
| 불변 | 아님 | 기본 불변(`init`) | 아님 |
| 복사 | 참조 복사 | 참조 복사 (`with` 로 사본) | **값 복사** |
| 용도 | 엔티티·서비스 | DTO · 값 객체 · 응답 | 작은 값 (`Point`) |

- `record` 는 **참조 타입**이다. 이름에 속지 말 것. 값 타입 record 는 `record struct`.
- `record` 는 `ToString()` · `Equals()` · `GetHashCode()` · `Deconstruct()` 를 자동 생성한다.
- EF Core 엔티티에 record 는 보통 안 쓴다 (변경 추적이 참조 동등성을 기대하므로). DTO 에 쓴다.

---

## 5. 컬렉션과 제네릭

### 자주 쓰는 컬렉션

| 타입 | 특징 |
| --- | --- |
| `List<T>` | 동적 배열. 인덱스 접근 O(1), 끝에 추가 O(1) |
| `T[]` | 고정 길이 배열 |
| `Dictionary<K,V>` | 해시 맵. 조회 O(1) |
| `HashSet<T>` | 중복 없는 집합 |
| `Queue<T>` / `Stack<T>` | FIFO / LIFO |
| `IReadOnlyList<T>` | 읽기 전용 **뷰** (불변이 아니다) |

### 컬렉션 식 (C# 12)

```csharp
int[] a = [1, 2, 3];
List<int> b = [..a, 4, 5];        // 스프레드 .. 로 펼친다
IEnumerable<int> c = [];           // 빈 컬렉션
```

### 제네릭 제약

```csharp
public T Max<T>(T a, T b) where T : IComparable<T> => a.CompareTo(b) > 0 ? a : b;
```

| 제약 | 의미 |
| --- | --- |
| `where T : class` | 참조 타입만 |
| `where T : struct` | 값 타입만 |
| `where T : new()` | 매개변수 없는 생성자 필요 |
| `where T : IFoo` | 인터페이스 구현 필요 |
| `where T : notnull` | null 불가 |

**공변·반공변:** `IEnumerable<out T>` 는 공변이라 `IEnumerable<Dog>` 를 `IEnumerable<Animal>` 에 넣을 수 있다. `List<Dog>` 는 **안 된다**.

---

## 6. 델리게이트 · 람다 · 이벤트

| 타입 | 의미 |
| --- | --- |
| `Action<...>` | 반환값 **없는** 델리게이트 |
| `Func<..., TResult>` | 반환값 **있는** 델리게이트. 마지막 타입 인자가 반환형 |
| `Predicate<T>` | `bool` 을 돌려주는 `Func<T, bool>` (오래된 이름) |
| `Expression<Func<..>>` | 코드가 아니라 **식 트리** (EF Core 가 SQL 로 번역) |

```csharp
Func<int, int, int> add = (a, b) => a + b;
Action<string> log = s => Console.WriteLine(s);
```

- 람다는 바깥 변수를 **캡처**한다. `for` 변수를 캡처하면 같은 값을 보는 고전적 함정이 있다 (`foreach` 는 C# 5 부터 안전).
- `event` 는 델리게이트를 감싸서 **밖에서는 `+=` / `-=` 만** 하게 막는다. 밖에서 `= null` 또는 직접 호출은 못 한다.

---

## 7. 패턴 매칭 · switch 식

```csharp
string Describe(object o) => o switch
{
    null            => "없음",
    int n when n < 0 => "음수",
    int n           => $"정수 {n}",
    string { Length: 0 } => "빈 문자열",
    string s        => s,
    Person { Age: >= 20 } p => $"성인 {p.Name}",
    [1, 2, ..]      => "1, 2 로 시작하는 리스트",
    _               => "그 외",
};
```

| 패턴 | 예 |
| --- | --- |
| 타입 | `o is string s` |
| 상수 | `x is 3` · `x is null` |
| 관계 | `n is >= 0 and < 10` |
| 논리 | `and` `or` `not` |
| 프로퍼티 | `p is { Age: > 18 }` |
| 리스트 | `[1, 2, ..]` |

- `switch` **식** 은 값을 돌려주고, 모든 경우를 다루지 않으면 컴파일러가 경고한다. `_` 는 버림(discard).
- `is not null` 이 `!= null` 보다 낫다 — `==` 연산자 오버로드에 영향받지 않는다.

---

## 8. 문자열

```csharp
var s = $"안녕 {name}, 나이 {age:N0}";           // 보간
var raw = """
    {"id": 1, "name": "kim"}
    """;                                            // 원시 문자열 (C# 11) — 따옴표 이스케이프 불필요
var verbatim = @"C:\temp\a.txt";                    // 축자 문자열
```

- 반복문에서 `+=` 로 문자열을 이으면 매번 새 문자열이 생긴다 → `StringBuilder`.
- 비교는 `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)`. `==` 는 대소문자를 구분한다.
- `string.IsNullOrEmpty` / `IsNullOrWhiteSpace`.

---

## 9. async / await

```csharp
public async Task<User> GetAsync(int id, CancellationToken ct)
{
    var user = await _http.GetFromJsonAsync<User>($"/users/{id}", ct);
    return user ?? throw new NotFoundException();
}
```

| 반환형 | 쓰임 |
| --- | --- |
| `Task` | 값 없는 비동기 |
| `Task<T>` | 값 있는 비동기 |
| `ValueTask<T>` | 대부분 동기로 끝나는 hot path. 할당을 줄인다. **한 번만 await** |
| `void` | ❌ 이벤트 핸들러 외엔 금지 |

- `.Result` · `.Wait()` 는 동기로 막아 **데드락**을 일으킬 수 있다. 끝까지 `await`.
- `async void` 의 예외는 잡을 수 없고 프로세스를 죽일 수 있다.
- `Task.WhenAll(a, b)` 로 병렬 대기, `Task.WhenAny` 로 먼저 끝난 것.
- `CancellationToken` 은 **협조적 취소**다. 받아서 하위 호출에 계속 넘겨야 한다.
- `await` 는 스레드를 **점유하지 않고 반납**한다. 비동기는 "스레드를 더 만드는 것"이 아니다.
- `IAsyncEnumerable<T>` + `await foreach` 로 비동기 스트림.

---

## 10. 예외 · using

```csharp
try { ... }
catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound) { ... }
catch (Exception ex) { _log.LogError(ex, "실패"); throw; }   // throw; 로 스택 유지
finally { ... }
```

- `throw;` 는 스택 트레이스를 **보존**하고, `throw ex;` 는 **지운다**. 항상 `throw;`.
- `when` 필터는 조건이 거짓이면 catch 로 들어가지도 않는다.
- `using` 은 `IDisposable.Dispose()` 를 **블록 끝에서 자동 호출**한다.

```csharp
using var conn = new SqlConnection(cs);     // 범위 끝에서 Dispose (C# 8 선언 형태)
await using var db = await factory.CreateAsync();  // IAsyncDisposable
```

---

## 11. 확장 메서드 · 최신 기능

```csharp
public static class StringExt
{
    public static bool IsEmail(this string s) => s.Contains('@');   // this 가 확장 대상
}
"a@b".IsEmail();
```

- 확장 메서드는 **정적 클래스의 정적 메서드**다. 인스턴스 메서드가 같은 이름이면 **인스턴스가 이긴다**.
- LINQ 전체가 `IEnumerable<T>` 의 확장 메서드다.

### 버전별 새 문법 (알아 둘 것)

| 버전 | 대표 기능 |
| --- | --- |
| C# 11 | `required` · 원시 문자열 · 리스트 패턴 · `file` |
| C# 12 (.NET 8) | 기본 생성자 · 컬렉션 식 · 람다 기본값 |
| C# 13 (.NET 9) | `params` 컬렉션 (`params ReadOnlySpan<T>`) · 새 `Lock` 타입 |
| C# 14 (.NET 10) | `field` 키워드 · 확장 멤버(extension block) · `?.=` · 부분 생성자 |

```csharp
// C# 14: field — 자동 프로퍼티에 로직을 얹을 때 백킹 필드를 안 만들어도 된다
public string Name
{
    get;
    set => field = value?.Trim() ?? "";
}
```

---

## 12. 자주 틀리는 것

1. `record` 는 **참조 타입**. 값 타입은 `record struct`.
2. 메서드는 기본이 비가상 — `virtual` 이 있어야 `override`.
3. `internal` 은 **같은 어셈블리**. 클래스 기본 접근자다.
4. `string` 은 참조 타입이지만 불변. 비교(`==`)는 값 비교.
5. 기본 생성자 파라미터는 **필드가 아니다** (record 와 다르다).
6. `.Result` / `.Wait()` → 데드락. `async void` → 예외 못 잡음.
7. `throw ex;` 는 스택을 지운다. `throw;` 를 쓴다.
8. `ref` 는 호출 전 초기화 필요, `out` 은 메서드가 채워야 한다.
9. `Func` 의 마지막 타입 인자는 **반환형**.
10. `IEnumerable<Dog>` 는 `IEnumerable<Animal>` 에 가능(공변), `List<Dog>` 는 불가.

---

## 스스로 답해보기

1. 값 타입과 참조 타입을 대입했을 때 각각 무슨 일이 생기나? `string` 은 어느 쪽처럼 행동하나?
2. `?.` · `??` · `??=` · `!` 를 각각 한 줄로 설명하라.
3. `get; set;` · `get; init;` · `required` 의 차이는?
4. `class` · `record` · `struct` 를 동등성 기준으로 비교하라. `record` 는 값 타입인가?
5. 기본 생성자(primary constructor)의 파라미터는 필드인가? record 와 무엇이 다른가?
6. `internal` 과 `protected internal` 의 접근 범위는?
7. `Func<int, string>` 과 `Action<int>` 의 차이는?
8. `async void` 가 위험한 이유와 `.Result` 가 데드락을 일으키는 이유를 말하라.
9. `throw;` 와 `throw ex;` 는 무엇이 다른가?
10. C# 12 · 13 · 14 에서 각각 하나씩 새 기능을 들어라.
