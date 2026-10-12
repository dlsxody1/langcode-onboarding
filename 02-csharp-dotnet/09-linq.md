# LINQ — Enumerable 메서드 전부, 시험용

`01-csharp-for-ts-devs.md` 4절에서 LINQ 를 "배열 메서드와 거의 같다"고 맛봤다. 이 문서는 **시험 대비용 완전판**이다.
메서드를 카테고리로 묶고, 각각 "지연이냐 즉시냐"와 "자주 틀리는 지점"을 붙였다.

> 공식 문서: [Enumerable 클래스](https://learn.microsoft.com/ko-kr/dotnet/api/system.linq.enumerable?view=net-10.0) ·
> [LINQ 개요](https://learn.microsoft.com/ko-kr/dotnet/csharp/linq/)

---

## 1. 먼저 큰 그림 세 가지

| 질문 | 답 |
| --- | --- |
| LINQ 메서드는 어디 있나 | `System.Linq.Enumerable` 의 **확장 메서드**. 대상은 `IEnumerable<T>` |
| 쿼리 구문과 메서드 구문 | 컴파일하면 똑같다. 쿼리 구문(`from … select`)은 메서드 호출로 번역된다 |
| `IQueryable<T>` 는 | 식 트리를 받아 **SQL 로 번역**한다. EF Core 가 쓴다. `Func` 가 아니라 `Expression<Func>` |

```csharp
// 메서드 구문
var r = users.Where(u => u.Age >= 20).OrderBy(u => u.Name).Select(u => u.Name);

// 쿼리 구문 — 위와 같은 결과
var r2 = from u in users
         where u.Age >= 20
         orderby u.Name
         select u.Name;
```

---

## 2. 지연 실행 vs 즉시 실행 — 제일 많이 나온다

**지연(deferred)**: 메서드를 호출한 시점에는 아무 일도 안 한다. `foreach` 로 **열거할 때** 비로소 계산한다.
**즉시(immediate)**: 호출하는 순간 결과를 만들어 낸다.

| 구분 | 메서드 |
| --- | --- |
| 지연 | `Where` `Select` `SelectMany` `OrderBy` `GroupBy` `Join` `Skip` `Take` `Distinct` `Concat` `Zip` `Reverse` `Cast` `OfType` |
| 즉시 (값 하나) | `Count` `Sum` `Min` `Max` `Average` `Aggregate` `First` `Single` `Last` `ElementAt` `Any` `All` `Contains` |
| 즉시 (컬렉션) | `ToList` `ToArray` `ToDictionary` `ToHashSet` `ToLookup` |

```csharp
var nums = new List<int> { 1, 2, 3 };
var q = nums.Where(n => n > 1);   // 아직 아무것도 안 했다
nums.Add(10);                      // 원본이 바뀐다
Console.WriteLine(q.Count());      // 3  ← (2, 3, 10). 열거 시점의 원본을 본다
```

**함정 1 — 다중 열거.** `q` 를 두 번 열거하면 쿼리가 **두 번** 실행된다. DB 쿼리라면 DB 를 두 번 친다.
결과를 여러 번 쓸 거면 `ToList()` 로 한 번 굳힌다.

**함정 2 — 지연 + 변수 캡처.** 람다가 바깥 변수를 잡고 있으면, 열거 시점의 값을 쓴다.

**함정 3 — 정렬·그룹은 "지연이지만 열거 시작하면 전부 읽는다".** `OrderBy` 는 첫 요소를 내려면 전체를 봐야 한다.
(`Where` 는 하나씩 흘려보내는 스트리밍, `OrderBy` 는 버퍼링.)

### JS 와 비교

JS 배열 메서드는 **전부 즉시 실행**이다. 호출하는 순간 새 배열을 만든다. LINQ 는 대부분 **지연**이라 이 부분이 가장 다르다.

```js
const nums = [1, 2, 3];
const q = nums.filter(n => n > 1);   // 이 줄에서 바로 [2, 3] 이 만들어진다
nums.push(10);
q.length;                            // 2  (이미 끝난 결과라 원본이 바뀌어도 그대로)
```

```csharp
var q = nums.Where(n => n > 1);      // 아무것도 안 했다
nums.Add(10);
q.Count();                           // 3  (센 시점에 원본을 읽는다)
```

| JS 배열 | LINQ |
| --- | --- |
| `map` | `Select` |
| `filter` | `Where` |
| `flatMap` | `SelectMany` |
| `reduce` | `Aggregate` |
| `find` | `FirstOrDefault(조건)` |
| `some` / `every` | `Any` / `All` |
| `includes` | `Contains` |
| `slice(0, n)` | `Take(n)` |
| `.sort()` (원본을 바꾼다) | `OrderBy` (원본은 그대로, 새 시퀀스) |
| `Array.from(x)` / `[...x]` | `ToList()` / `ToArray()` |

JS 의 **제너레이터**(`function*`)가 LINQ 와 가장 비슷한 동작이다. 값을 요청할 때마다 하나씩 계산한다. 결과를 굳히고 싶을 때 `ToList()` 를 붙이는 것은 JS 에서 `[...gen]` 으로 펼치는 것과 같다.

---

## 3. 필터 · 투영

| 메서드 | 설명 | 실행 |
| --- | --- | --- |
| `Where` | 조건에 맞는 것만. 인덱스 오버로드 있음 | 지연 |
| `OfType<T>` | 타입이 T 인 것만 걸러낸다 | 지연 |
| `Cast<T>` | 전부 T 로 캐스팅. 하나라도 안 맞으면 예외 | 지연 |
| `Select` | 요소 1개 → 1개로 변환 | 지연 |
| `SelectMany` | 요소 1개 → 여러 개로 펼쳐서 **한 줄로 합침** | 지연 |

```csharp
var orders = new[] { new { Id = 1, Items = new[] { "a", "b" } },
                     new { Id = 2, Items = new[] { "c" } } };

orders.Select(o => o.Items);       // [["a","b"], ["c"]]  — 배열의 배열
orders.SelectMany(o => o.Items);   // ["a","b","c"]      — 평평하게
```

> `Select` 는 map, `SelectMany` 는 flatMap 이다. `OfType` 은 **거르고**, `Cast` 는 **터진다**.

---

## 4. 정렬

| 메서드 | 설명 |
| --- | --- |
| `OrderBy` / `OrderByDescending` | 첫 번째 키로 정렬 |
| `ThenBy` / `ThenByDescending` | 두 번째 이후 키. **`OrderBy` 뒤에만** 쓴다 |
| `Order` / `OrderDescending` | 키 없이 요소 자체로 정렬 (.NET 7+) |
| `Reverse` | 순서를 뒤집는다 |

- **안정 정렬(stable)** 이다. 키가 같으면 원래 순서가 유지된다.
- `OrderBy(a).OrderBy(b)` 는 **b 가 우선**이 된다 (뒤의 정렬이 앞을 덮는다). 다중 키는 `OrderBy(a).ThenBy(b)`.

---

## 5. 그룹 · 조인

### GroupBy

```csharp
var g = users.GroupBy(u => u.Dept);   // IEnumerable<IGrouping<string, User>>
foreach (var grp in g)
    Console.WriteLine($"{grp.Key}: {grp.Count()}");
```

`IGrouping<TKey, T>` 는 `Key` 를 가진 컬렉션이다. SQL 의 GROUP BY 와 달리 **그룹 안의 요소를 그대로 들고 있다**.

### Join 종류

| 메서드 | SQL 로 치면 | 메모 |
| --- | --- | --- |
| `Join` | INNER JOIN | 양쪽 다 있는 것만 |
| `GroupJoin` | LEFT JOIN 의 재료 | 바깥 요소마다 **안쪽 컬렉션**을 붙인다 |
| `LeftJoin` | LEFT JOIN | .NET 10 에서 추가. 예전엔 `GroupJoin` + `SelectMany` + `DefaultIfEmpty` |
| `RightJoin` | RIGHT JOIN | .NET 10 에서 추가 |

```csharp
// .NET 9 이전의 LEFT JOIN 관용구
var r = from u in users
        join o in orders on u.Id equals o.UserId into g
        from o in g.DefaultIfEmpty()
        select new { u.Name, OrderId = o?.Id };
```

`Join` 은 **키 같음(equals)** 만 지원한다. 범위 조인은 `SelectMany` + `Where` 로 푼다.

---

## 6. 집계

| 메서드 | 빈 시퀀스일 때 |
| --- | --- |
| `Count` / `LongCount` | 0 |
| `Sum` | 0 |
| `Average` | **예외** (`InvalidOperationException`) |
| `Min` / `Max` | **예외** (값 형식일 때). 참조 형식·nullable 이면 null |
| `Aggregate` | seed 없으면 예외, 있으면 seed |

- `Any()` 는 "하나라도 있나" 를 **첫 요소에서 멈춘다**. `Count() > 0` 보다 낫다 — `Count()` 는 끝까지 센다 (단, `ICollection` 이면 `Count` 속성을 쓰는 최적화가 있다).
- `Aggregate` 는 reduce 다: `nums.Aggregate(0, (acc, n) => acc + n)`.

---

## 7. 요소 하나를 꺼내기 — 시험 단골

| 메서드 | 0 개일 때 | 2 개 이상일 때 |
| --- | --- | --- |
| `First` | 예외 | 첫 번째 |
| `FirstOrDefault` | 기본값 (참조 형식은 null) | 첫 번째 |
| `Single` | 예외 | **예외** |
| `SingleOrDefault` | 기본값 | **예외** |
| `Last` / `LastOrDefault` | 예외 / 기본값 | 마지막 |
| `ElementAt` / `ElementAtOrDefault` | 예외 / 기본값 | 해당 위치 |

- "유일해야 하는 값"에는 `Single` — 2 개면 데이터 오류를 **터뜨려서** 알려 준다.
- "있으면 쓰고 없으면 말고" 는 `FirstOrDefault`.
- `FirstOrDefault(defaultValue)` 오버로드 (.NET 6+) — `int` 에서 기본값이 0 이 아니라 내가 정한 값.
- `^1`(끝에서 첫째) 인덱스: `ElementAt(^1)` 은 .NET 6+.

---

## 8. 수량자 · 비교

| 메서드 | 의미 |
| --- | --- |
| `Any()` / `Any(pred)` | 하나라도 만족? 빈 시퀀스면 **false** |
| `All(pred)` | 전부 만족? 빈 시퀀스면 **true** (공허한 참) |
| `Contains(x)` | 포함? |
| `SequenceEqual` | 같은 순서로 같은 요소? |

`All` 이 빈 시퀀스에서 `true` 인 것이 함정이다. "전부 통과했나" 를 검사하면서 비어 있는 경우를 놓친다.

---

## 9. 집합 · 합치기

| 메서드 | 결과 | 중복 |
| --- | --- | --- |
| `Distinct` | 중복 제거 | 제거 |
| `Union` | 합집합 | 제거 |
| `Concat` | 이어 붙이기 | **유지** |
| `Intersect` | 교집합 | 제거 |
| `Except` | 차집합 (앞에서 뒤를 뺌) | 제거 |
| `Zip` | 같은 위치끼리 묶음. 짧은 쪽에서 끝 | — |

- `Union` 과 `Concat` 의 차이: **`Concat` 은 중복을 안 지운다.** 많이 헷갈린다.
- 요소가 클래스면 `Distinct` 가 **참조 비교**를 한다 → 같은 값인데 중복으로 안 잡힌다. `record` 를 쓰거나 `IEqualityComparer`, 또는 `DistinctBy`.

---

## 10. 분할 · 페이지네이션

| 메서드 | 의미 |
| --- | --- |
| `Take(n)` / `Skip(n)` | 앞 n 개 / 앞 n 개 건너뜀 |
| `TakeWhile` / `SkipWhile` | 조건이 **처음 깨질 때까지** |
| `TakeLast` / `SkipLast` | 뒤 n 개 |
| `Take(range)` | `Take(2..5)` 범위 (.NET 6+) |
| `Chunk(n)` | n 개씩 배열로 쪼갬 (.NET 6+) |

```csharp
// 페이지네이션 — 반드시 정렬을 먼저
var page = items.OrderBy(i => i.Id).Skip((page - 1) * size).Take(size);
```

`TakeWhile` 은 `Where` 와 다르다. `[1, 5, 2, 8]` 에서 `TakeWhile(n => n < 5)` 는 `[1]`, `Where(n => n < 5)` 는 `[1, 2]`.

---

## 11. 변환 · 생성

| 메서드 | 결과 | 메모 |
| --- | --- | --- |
| `ToList` / `ToArray` | 리스트 / 배열 | 즉시 실행 |
| `ToDictionary` | 딕셔너리 | **키 중복이면 예외** |
| `ToHashSet` | 해시셋 | |
| `ToLookup` | 키 하나에 값 여럿 | 중복 키 OK, 즉시 실행 |
| `AsEnumerable` | `IQueryable` → `IEnumerable` | 이후 연산은 **메모리에서** |
| `DefaultIfEmpty` | 비었으면 기본값 하나 | LEFT JOIN 용 |
| `Range(a, n)` | a 부터 n 개의 정수 | |
| `Repeat(x, n)` | x 를 n 번 | |
| `Empty<T>()` | 빈 시퀀스 | |

> `ToDictionary` vs `ToLookup`: 키가 유일하면 Dictionary, 겹칠 수 있으면 Lookup. `GroupBy` 와의 차이는 Lookup 은 **즉시 실행**이라는 것.

---

## 12. .NET 버전별로 늘어난 것

| 버전 | 추가된 메서드 |
| --- | --- |
| .NET 6 | `Chunk` `MinBy` `MaxBy` `DistinctBy` `UnionBy` `IntersectBy` `ExceptBy` `TryGetNonEnumeratedCount` `Take(Range)` `ElementAt(Index)` `FirstOrDefault(default)` `Zip` 3 개 |
| .NET 7 | `Order` `OrderDescending` |
| .NET 9 | `CountBy` `AggregateBy` `Index` |
| .NET 10 | `LeftJoin` `RightJoin` |

```csharp
words.MinBy(w => w.Length);                 // 길이가 가장 짧은 "단어 자체" (Min 은 값만)
words.CountBy(w => w[0]);                   // 첫 글자별 개수. GroupBy 보다 가볍다
words.Index();                              // (Index, Item) 튜플 — 예전엔 Select((x, i) => ...)
users.DistinctBy(u => u.Email);             // Email 이 같으면 중복
```

`MinBy` / `MaxBy` 는 **요소**를 돌려주고, `Min` / `Max` 는 **키 값**을 돌려준다.

> 문서 목록에는 이보다 더 새로운 `Shuffle` · `Sequence` · `InfiniteSequence` 같은 것도 보이지만, 어느 버전부터인지 확인하지 못했다. 시험에 나올 가능성은 낮다.

---

## 13. IEnumerable vs IQueryable — EF Core 와 만나는 곳

| | `IEnumerable<T>` | `IQueryable<T>` |
| --- | --- | --- |
| 람다 타입 | `Func<T, bool>` (코드) | `Expression<Func<T, bool>>` (식 트리) |
| 실행 위치 | 메모리 (.NET) | **DB** (SQL 로 번역) |
| 번역 못 하면 | 문제 없음 | **런타임 예외** |

```csharp
// ❌ 전부 가져와서 메모리에서 거른다
db.Users.AsEnumerable().Where(u => u.Age > 20).ToList();

// ✅ WHERE 가 SQL 에 들어간다
db.Users.Where(u => u.Age > 20).ToList();
```

`AsEnumerable()` 를 **너무 일찍** 호출하면 이후 `Where` 가 DB 가 아니라 메모리에서 돈다. 데이터가 크면 그대로 장애다.
EF Core 쪽 이야기는 `03-ef-core.md` 3-2 를 보라.

---

## 14. 자주 틀리는 것 한 줄 요약

1. `Where` 는 지연 — 선언하고 `ToList()` 안 하면 아무 일도 안 한다.
2. 같은 쿼리를 두 번 열거하면 **두 번 실행**.
3. `First` 는 없으면 예외, `FirstOrDefault` 는 null/기본값, `Single` 은 **둘 이상이어도** 예외.
4. `All` 은 빈 시퀀스에서 `true`, `Any` 는 `false`.
5. `Concat` 은 중복 유지, `Union` 은 제거.
6. `Average` / `Min` / `Max` 는 빈 시퀀스에서 예외 (값 형식).
7. `OrderBy().OrderBy()` 는 마지막이 이긴다. 다중 키는 `ThenBy`.
8. `ToDictionary` 는 키 중복에 예외, `ToLookup` 은 괜찮다.
9. `SelectMany` 는 펼친다. `Select` 는 안 펼친다.
10. 페이지네이션 `Skip/Take` 는 **정렬 뒤에**.

---

## 스스로 답해보기

1. 지연 실행과 즉시 실행의 차이를 설명하고, 각각 메서드 두 개씩 들어라.
2. `var q = list.Where(...)` 를 `foreach` 두 번 돌리면 몇 번 실행되나? 어떻게 막나?
3. `First` · `FirstOrDefault` · `Single` · `SingleOrDefault` 를 "0 개일 때 / 2 개 이상일 때" 로 비교하라.
4. `Select` 와 `SelectMany` 의 차이를 예로 설명하라.
5. `Union` 과 `Concat` 의 차이는? 클래스 요소에서 `Distinct` 가 의도대로 안 되는 이유는?
6. `All` 과 `Any` 가 빈 시퀀스에서 돌려주는 값은?
7. `ToDictionary` 와 `ToLookup` 은 키가 중복될 때 어떻게 다른가?
8. `MinBy` 와 `Min` 은 무엇이 다른가? 어느 버전에 생겼나?
9. `IEnumerable` 과 `IQueryable` 의 차이는? `AsEnumerable()` 를 너무 일찍 부르면 무슨 일이 생기나?
10. 페이지네이션에서 `OrderBy` 가 먼저여야 하는 이유는?
