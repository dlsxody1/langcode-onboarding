# 캐싱

**캐시는 "느린 곳에서 가져온 결과를 빠른 곳에 잠시 맡겨 두는 것"이다.**
프론트에서 TanStack Query 의 `staleTime` 을 고민해 봤다면 이미 절반은 안다. 서버에서는 같은 고민을 **여러 사용자 · 여러 서버** 단위로 한다.

> 캐시의 두 가지 어려움: **언제 버리나(무효화)**, 그리고 **누구 것인가(격리)**. 이 문서는 사실상 이 둘에 대한 이야기다.

이 문서에 계속 나오는 말부터 정리한다.

| 용어 | 뜻 | 프론트에서 비슷한 것 |
| --- | --- | --- |
| cache hit / miss | 캐시에 값이 있어서 바로 꺼냄 / 없어서 원본까지 다녀옴 | TanStack Query 가 캐시된 데이터를 바로 주는가, `queryFn` 을 부르는가 |
| TTL (Time To Live) | 캐시에 넣은 값의 **유효 기간.** 지나면 자동으로 버린다 | `staleTime` 과 비슷하다. 다만 지나면 옛 값을 보여주지 않고 아예 버린다 |
| 무효화 (invalidation) | 원본이 바뀌어서 캐시 값을 **일부러** 버리는 것 | `queryClient.invalidateQueries()` |
| 직렬화 | 객체를 문자열·바이트로 바꾸는 것. Redis 같은 외부 캐시에는 객체를 그대로 못 넣는다 | `JSON.stringify` |

---

## 1. 캐시는 여러 층에 있다

```
브라우저 ──▶ CDN ──▶ 서버(앱 메모리) ──▶ 분산 캐시(Redis) ──▶ DB
 HTTP 캐시   정적 파일   IMemoryCache       IDistributedCache       원본
```

| 층 | 속도 | 공유 범위 | 쓰는 곳 |
| --- | --- | --- | --- |
| 브라우저 HTTP 캐시 | 가장 빠름 | 사용자 1명 | `Cache-Control`, `ETag` |
| CDN | 빠름 | 전 세계 사용자 | 이미지·JS·공개 페이지 |
| **앱 메모리** (`IMemoryCache`) | 나노초 | **서버 1대 안에서만** | 거의 안 바뀌는 설정·코드표 |
| **분산 캐시** (Redis) | 1ms 안팎 | **모든 서버** | 사용자·테넌트 데이터, 세션 |
| DB | 수 ms \~ 수 초 | 원본 | |

CDN(Content Delivery Network)은 전 세계 곳곳에 둔 캐시 서버 묶음이다. 사용자와 가까운 곳에서 파일을 대신 내려 준다.
`IMemoryCache` 는 서버 프로세스 안의 `Map` 이라고 보면 되고 분산 캐시는 서버들이 네트워크로 함께 쓰는 바깥의 `Map` 이다.

**앱 메모리 캐시의 함정:** 서버가 3대면 캐시도 3벌이다. 서버 A 에서 지운 캐시가 B·C 에는 남아 있다.
로드밸런서(요청을 여러 서버에 나눠 주는 장치)는 새로고침할 때마다 사용자를 다른 서버로 보낼 수 있다. 그래서 사용자 눈에는 **값이 바뀌었다 돌아왔다** 한다. (→ `05-infra.md` 무상태)

---

## 2. Cache-aside — 가장 흔한 패턴

```
읽기
  ① 캐시에 있나?  ── 있다 ──▶ 그대로 반환 (cache hit)
        │
       없다 (cache miss)
        ▼
  ② DB 에서 읽는다
  ③ 캐시에 넣는다 (TTL 과 함께)
  ④ 반환

쓰기
  ① DB 를 갱신한다
  ② 캐시를 지운다   ← 갱신이 아니라 "삭제"
```

앱 코드가 캐시를 직접 관리해서 "옆에 둔다(aside)"는 이름이 붙었다. DB 와 캐시가 알아서 동기화되는 게 아니라 **앱이 캐시를 먼저 보고 없으면 DB 에 다녀와서 채워 넣는** 구조다.
프론트에서 `const cached = map.get(key) ?? await fetchAndStore(key)` 를 손으로 짜는 것과 같다.

```csharp
public async Task<PetDto?> GetAsync(Guid tenantId, Guid id)
{
    var key = $"t:{tenantId}:pet:{id}";                      // ← 테넌트를 키에 (4절)

    var cached = await _cache.GetStringAsync(key);
    if (cached is not null)
        return JsonSerializer.Deserialize<PetDto>(cached);

    var pet = await _repo.FindAsync(tenantId, id);
    if (pet is not null)
        await _cache.SetStringAsync(key, JsonSerializer.Serialize(pet),
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5) });

    return pet;
}

public async Task UpdateAsync(Guid tenantId, Guid id, UpdatePetDto dto)
{
    await _repo.UpdateAsync(tenantId, id, dto);
    await _cache.RemoveAsync($"t:{tenantId}:pet:{id}");      // 쓰고 나서 지운다
}
```

`AbsoluteExpirationRelativeToNow = 5분` 이 TTL 이다. 넣은 시점부터 5분이 지나면 Redis 가 키를 지운다.

### 왜 쓸 때 캐시를 "갱신"하지 않고 "삭제"하나

두 요청이 거의 동시에 수정하면:

```
요청 A: DB ← 이름 "초코"
요청 B: DB ← 이름 "보리"
요청 B: 캐시 ← "보리"
요청 A: 캐시 ← "초코"      ← 늦게 도착한 A 가 덮어씀

결과: DB 는 "보리", 캐시는 "초코". TTL 이 끝날 때까지 틀린 값을 보여준다
```

삭제는 순서가 꼬여도 **다음 읽기가 DB 에서 새로 가져오므로** 스스로 복구된다. 갱신보다 안전한 기본값이다.

---

## 3. TTL 과 무효화 — "언제 버리나"

| 전략 | 동작 | 장점 | 단점 |
| --- | --- | --- | --- |
| **TTL 만** | 5분 지나면 자동 삭제 | 단순. 버그가 있어도 5분 뒤 복구 | 최대 5분간 옛날 값 |
| **쓰기 시 삭제** | 수정 API 에서 키를 지운다 | 바로 반영 | 키를 빠뜨리면 영원히(TTL 까지) 틀림 |
| **둘 다** | 쓰기 시 삭제 + 안전망 TTL | 실무 표준 | |

**TTL 은 항상 건다.** 무효화 코드는 언젠가 빠뜨린다. TTL 은 그때의 피해 상한선이다.

TTL 에는 두 종류가 있다. **절대 만료**(absolute)는 넣은 시점부터 시간을 잰다. **슬라이딩 만료**(sliding)는 마지막으로 읽은 시점부터 다시 잰다.
슬라이딩만 걸면 자주 읽히는 키는 영원히 안 만료될 수 있다. 원본이 바뀌어도 옛 값이 계속 살아남으니 절대 만료를 기본으로 쓴다.

### 키를 빠뜨리는 전형적인 경우

`pet:{id}` 는 지웠는데 **같은 데이터가 들어간 다른 키**를 잊는다.

```
t:{tenant}:pet:{id}               ← 지웠다
t:{tenant}:owner:{ownerId}:pets   ← 펫 목록. 이것도 바뀌었는데 안 지웠다
t:{tenant}:dashboard:stats        ← 펫 수 통계. 이것도
```

그래서 **목록·집계는 짧은 TTL 에 맡기고** 무효화는 단건 키에만 하는 경우가 많다.
"무효화해야 할 키를 다 셀 수 없다면, 그 데이터는 캐시하지 않거나 TTL 을 짧게 한다."

### TTL 은 얼마로?

| 데이터 | 출발점 |
| --- | --- |
| 코드표 · 설정 · 권한 정책 | 수십 분 \~ 수 시간 (+ 변경 시 삭제) |
| 사용자 프로필 · 단건 조회 | 수 분 |
| 목록 · 대시보드 집계 | 수십 초 \~ 수 분 |
| **권한 · 잔액 · 재고** | **캐시하지 않거나 매우 짧게.** 틀리면 사고다 |

---

## 4. 멀티테넌트 캐시 사고 — 가장 위험한 실수

```csharp
var key = $"pet:{id}";                 // ❌ 테넌트가 키에 없다
var key = $"dashboard:stats";          // ❌ 더 나쁘다 — 모든 고객사가 같은 키
```

DB 쿼리에는 `WHERE tenant_id = @t` 를 꼬박꼬박 붙여 놓고 **캐시 키에서 테넌트를 빠뜨리면** 격리가 그 자리에서 무너진다.
A 고객사 대시보드가 캐시되고, B 고객사 사용자가 그 캐시를 받는다. 테스트에서는 테넌트가 하나라 절대 안 잡힌다.

TanStack Query 로 치면 `queryKey: ["dashboard"]` 로만 캐시하고 로그인 사용자를 바꿨을 때 이전 사용자의 데이터가 보이는 버그와 같다. 서버에서는 이게 **다른 회사의 데이터**라는 점이 다르다.

**규칙:**
- 키는 항상 `t:{tenantId}:` 로 시작한다. **키 생성을 한 곳(헬퍼)에 모아** 사람이 직접 문자열을 만들지 못하게 한다
- 사용자마다 결과가 다른 것(권한에 따라 보이는 문서가 다른 검색 결과)은 **사용자 단위 키**이거나, **캐시하지 않는다**
- RAG 검색 결과를 캐시하고 싶어지면 `03-rag/04-enterprise-rag.md` 의 권한 필터를 다시 읽는다. 질문이 같아도 **볼 수 있는 문서가 다르면 답이 다르다**

```csharp
// 키 헬퍼 예시 — 테넌트 없는 키는 만들 수 없게
public static class CacheKeys
{
    public static string Pet(Guid tenantId, Guid petId) => $"t:{tenantId}:pet:{petId}";
    public static string DashboardStats(Guid tenantId)  => $"t:{tenantId}:dashboard:stats";
}
```

---

## 5. 캐시 스탬피드 — 인기 키가 만료되는 순간

```
00:05:00  인기 키 만료
00:05:00  요청 500개가 동시에 miss → 500개가 동시에 DB 로 → DB 과부하
```

스탬피드(stampede)는 놀란 가축 떼가 한꺼번에 몰려 달리는 것을 가리키는 말이다. 캐시가 막아 주던 요청이 한순간에 전부 DB 로 쏟아지는 모습이 그와 같아서 붙은 이름이다.
평소에는 캐시 덕분에 DB 가 버티던 트래픽이라 **DB 가 감당할 수 있는 양이 아니다.** 그래서 DB 가 느려지고 느려진 사이 들어온 요청도 miss 라서 상황이 더 나빠진다.

**해결:**
- **한 명만 DB 에 가게 한다** — 같은 키에 대한 동시 miss 를 하나로 합친다(락 또는 single-flight)
- **TTL 에 무작위 편차** — 5분 ± 30초. 많은 키가 같은 순간에 만료되지 않게 (`03-resilience.md` 2절의 지터와 같은 원리)
- 무거운 키는 **만료 전에 미리 갱신**

single-flight 는 "같은 키로 진행 중인 요청이 있으면 새로 출발하지 말고 그 결과를 같이 기다린다"는 뜻이다.
TanStack Query 가 같은 `queryKey` 로 동시에 여러 컴포넌트가 요청해도 네트워크 요청을 한 번만 보내는 것과 같다. JS 로 쓰면 이렇다.

```ts
const inflight = new Map<string, Promise<Pet>>();
function getPet(key: string) {
  if (!inflight.has(key)) inflight.set(key, loadFromDb(key).finally(() => inflight.delete(key)));
  return inflight.get(key)!;          // 동시에 온 요청들은 같은 Promise 를 받는다
}
```

.NET 9 의 **`HybridCache`** (`Microsoft.Extensions.Caching.Hybrid`) 는 메모리 + 분산 캐시 2단 구조와 스탬피드 방지를 기본으로 해 준다.

```csharp
builder.Services.AddHybridCache();

var pet = await _hybridCache.GetOrCreateAsync(
    $"t:{tenantId}:pet:{id}",
    async ct => await _repo.FindAsync(tenantId, id, ct),   // miss 일 때 한 번만 실행
    new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(5) });
```

위 2절의 cache-aside 를 손으로 쓰는 대신 이걸 쓰는 게 새 코드의 기본값이다.

> ❓ 입사 후 확인: 회사는 Redis 를 쓰나? `IMemoryCache` / `IDistributedCache` / `HybridCache` 중 무엇을 쓰나?

### HybridCache 를 쓸 때 알아 둘 것

- **2단 구조:** 1단(L1)은 서버 메모리, 2단(L2)은 DI 에 등록된 `IDistributedCache` 다. `AddStackExchangeRedisCache(...)` 로 Redis 를 등록해 두면 그게 자동으로 L2 가 된다. 등록된 게 없으면 메모리만 쓴다.
- **직렬화를 대신 해 준다.** 2절처럼 `JsonSerializer` 를 직접 부를 필요가 없다.
- **스탬피드 방지는 서버 한 대 안에서다.** 같은 키로 동시에 온 요청 500개가 한 서버 안에서는 DB 호출 한 번으로 합쳐진다. 서버가 5대면 최악의 경우 5번 나간다. 대부분은 이 정도면 충분하다.
- **다른 서버의 L1 은 따로 논다.** `RemoveAsync` 로 지워도 다른 서버 메모리에 남은 사본은 그 서버의 L1 만료까지 살아 있을 수 있다. 바뀌면 바로 보여야 하는 데이터는 `LocalCacheExpiration` 을 짧게(수십 초) 잡는다. 1절의 "서버 3대면 캐시 3벌" 문제가 L1 에서는 그대로 남아 있는 셈이다.
- **태그로 묶어서 지울 수 있다.** 3절의 "목록 키를 빠뜨리는" 문제를 줄여 준다.

```csharp
var options = new HybridCacheEntryOptions
{
    Expiration = TimeSpan.FromMinutes(5),               // L2(Redis) 까지 포함한 전체 수명
    LocalCacheExpiration = TimeSpan.FromSeconds(30),    // 각 서버 메모리(L1)에 두는 시간
};

await _hybridCache.GetOrCreateAsync(
    CacheKeys.Pet(tenantId, id),
    async ct => await _repo.FindAsync(tenantId, id, ct),
    options,
    tags: [$"t:{tenantId}:pets"]);

// 이 테넌트의 펫 관련 캐시를 한꺼번에 무효화
await _hybridCache.RemoveByTagAsync($"t:{tenantId}:pets");
```

`HybridCache` 는 .NET 9 와 함께 나왔지만 NuGet 패키지라서 .NET 8 프로젝트에서도 쓸 수 있다.

> ❓ 입사 후 확인: 태그 무효화가 여러 서버의 L1 까지 어떻게 전파되는지는 패키지 버전마다 동작이 다를 수 있다. 회사가 쓰는 버전의 문서를 확인한다.

---

## 6. Redis — 캐시 말고도 쓰는 곳

Redis 는 "메모리에 있는 키-값 저장소"다. 빠르고 모든 서버가 공유하기 때문에 캐시 외에도 **"서버 여러 대가 같이 봐야 하는 작은 상태"** 를 둔다.

| 용도 | 왜 Redis 인가 |
| --- | --- |
| 캐시 | 위 내용 |
| 세션 저장소 | 서버 메모리에 두면 다른 서버로 가는 순간 로그아웃된다 |
| 레이트 리밋 카운터 | 서버별로 세면 서버 수만큼 한도가 늘어난다 (→ `03-resilience.md`) |
| 분산 락 | "이 잡은 한 서버만 돌려라" |
| SignalR 백플레인 | 서버 A 에 붙은 사용자에게 서버 B 가 메시지를 보낼 때 |
| 간단한 큐 | 정식 큐(Service Bus)를 쓰기 전 단계 |

분산 락은 여러 서버 중 **한 곳만** 어떤 일을 하도록 Redis 에 "내가 잡았다" 표시를 남기는 방식이다. 백플레인(backplane)은 서버들 사이에 메시지를 중계하는 공용 통로를 말한다.

**Redis 는 DB 가 아니다.** 설정에 따라 재시작 시 데이터가 사라질 수 있다. 메모리가 가득 차면 오래 안 쓴 키부터 지우도록 설정하는 경우도 많다. 그래서 **잃어도 DB 에서 다시 만들 수 있는 것만** 넣는다.

---

## 7. HTTP 캐시 — 프론트와 맞닿는 부분

서버가 응답 헤더로 브라우저·CDN 에게 캐시 규칙을 알려준다.

```
Cache-Control: public, max-age=31536000, immutable     ← 해시 붙은 JS/CSS. 1년
Cache-Control: private, no-cache                        ← 사용자별 API. 매번 서버에 확인
Cache-Control: no-store                                 ← 민감 정보. 저장 자체 금지
ETag: "a1b2c3"                                          ← 바뀌었는지 확인용 지문
```

| 지시어 | 뜻 |
| --- | --- |
| `public` | CDN 같은 공유 캐시도 저장 가능 |
| `private` | 브라우저만. **로그인 사용자 데이터에는 반드시** |
| `no-cache` | 저장은 하되, 쓰기 전에 서버에 "바뀌었나?" 묻는다 (ETag → `304 Not Modified`) |
| `no-store` | 아예 저장 안 함 |

`ETag` 는 응답 내용으로 만든 지문(해시 같은 값)이다. 브라우저가 다음 요청에 `If-None-Match: "a1b2c3"` 를 붙여 보내면 서버는 내용이 그대로일 때 본문 없이 `304` 만 돌려준다. 다시 받는 수고는 아끼고 최신인지는 매번 확인하는 방식이다.

**`no-cache` 는 "캐시하지 마"가 아니다.** 이름이 헷갈리는 대표적인 헤더다. 저장 금지는 `no-store`.
로그인 사용자 API 에 `public` 이 붙어 CDN 에 캐시되면 4절과 똑같은 사고가 CDN 에서 난다.

---

## 8. 캐시를 붙이기 전에

캐시는 **버그를 하나 더 만드는 대가로 속도를 사는 것**이다. 먼저 이걸 확인한다.

```
[ ] 정말 느린가? 측정했나? (01/03 의 EXPLAIN ANALYZE)
[ ] 인덱스·N+1·Projection 으로 해결되지 않나?        ← 대부분 여기서 끝난다
[ ] 이 데이터가 몇 초 틀려도 괜찮은가?
[ ] 무효화해야 할 키를 전부 셀 수 있나?
[ ] 키에 테넌트(·사용자)가 들어갔나?
```

실행 계획을 읽는 법은 `07-db-infra/01-relational-basics.md` 10절에 있다.

## 스스로 답해보기

1. 서버 3대에서 `IMemoryCache` 를 쓰면 사용자가 무엇을 보게 되나?
2. 수정 API 에서 캐시를 새 값으로 갱신하지 않고 삭제하는 이유는?
3. 무효화 코드가 있는데도 TTL 을 거는 이유는?
4. 캐시 키가 `dashboard:stats` 다. 멀티테넌트 서비스에서 무슨 일이 일어나나? 왜 테스트에서 안 잡히나?
5. 인기 키가 만료되는 순간 DB 가 죽었다. 무슨 현상이고 어떻게 막나?
6. `Cache-Control: no-cache` 와 `no-store` 의 차이는?
7. Redis 에 넣으면 안 되는 데이터는?
8. 서버 5대에서 `HybridCache` 를 쓴다. 인기 키가 만료되는 순간 DB 호출은 최악의 경우 몇 번 나가나?
9. 슬라이딩 만료만 걸어 둔 인기 키가 원본이 바뀐 뒤에도 계속 옛 값을 준다. 왜인가?
