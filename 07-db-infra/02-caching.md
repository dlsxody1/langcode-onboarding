# 캐싱

**캐시는 "느린 곳에서 가져온 결과를 빠른 곳에 잠시 맡겨 두는 것"이다.**
프론트에서 TanStack Query 의 `staleTime` 을 고민해 봤다면 이미 절반은 안다. 서버에서는 같은 고민을 **여러 사용자 · 여러 서버** 단위로 한다.

> 캐시의 두 가지 어려움: **언제 버리나(무효화)**, 그리고 **누구 것인가(격리)**. 이 문서는 사실상 이 둘에 대한 이야기다.

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

**앱 메모리 캐시의 함정:** 서버가 3대면 캐시도 3벌이다. 서버 A 에서 지운 캐시가 B·C 에는 남아 있다.
사용자는 새로고침할 때마다 로드밸런서가 다른 서버로 보내서 **값이 바뀌었다 돌아왔다** 한다. (→ `05-infra.md` 무상태)

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

앱 코드가 캐시를 직접 관리해서 "옆에 둔다(aside)"는 이름이 붙었다.

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

### 키를 빠뜨리는 전형적인 경우

`pet:{id}` 는 지웠는데 **같은 데이터가 들어간 다른 키**를 잊는다.

```
t:{tenant}:pet:{id}               ← 지웠다
t:{tenant}:owner:{ownerId}:pets   ← 펫 목록. 이것도 바뀌었는데 안 지웠다
t:{tenant}:dashboard:stats        ← 펫 수 통계. 이것도
```

그래서 **목록·집계는 짧은 TTL 에 맡기고**, 무효화는 단건 키에만 하는 경우가 많다.
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

DB 쿼리에는 `WHERE tenant_id = @t` 를 꼬박꼬박 붙여 놓고, **캐시 키에서 테넌트를 빠뜨리면** 격리가 그 자리에서 무너진다.
A 고객사 대시보드가 캐시되고, B 고객사 사용자가 그 캐시를 받는다. 테스트에서는 테넌트가 하나라 절대 안 잡힌다.

**규칙:**
- 키는 항상 `t:{tenantId}:` 로 시작한다. **키 생성을 한 곳(헬퍼)에 모아** 사람이 직접 문자열을 만들지 못하게 한다
- 사용자마다 결과가 다른 것(권한에 따라 보이는 문서가 다른 검색 결과)은 **사용자 단위 키**이거나, **캐시하지 않는다**
- RAG 검색 결과를 캐시하고 싶어지면 `03-rag/04-enterprise-rag.md` 의 권한 필터를 다시 읽는다. 질문이 같아도 **볼 수 있는 문서가 다르면 답이 다르다**

---

## 5. 캐시 스탬피드 — 인기 키가 만료되는 순간

```
00:05:00  인기 키 만료
00:05:00  요청 500개가 동시에 miss → 500개가 동시에 DB 로 → DB 과부하
```

**해결:**
- **한 명만 DB 에 가게 한다** — 같은 키에 대한 동시 miss 를 하나로 합친다(락 또는 single-flight)
- **TTL 에 무작위 편차** — 5분 ± 30초. 많은 키가 같은 순간에 만료되지 않게
- 무거운 키는 **만료 전에 미리 갱신**

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

---

## 6. Redis — 캐시 말고도 쓰는 곳

Redis 는 "메모리에 있는 키-값 저장소"다. 빠르고 모든 서버가 공유하기 때문에, 캐시 외에도 **"서버 여러 대가 같이 봐야 하는 작은 상태"** 를 둔다.

| 용도 | 왜 Redis 인가 |
| --- | --- |
| 캐시 | 위 내용 |
| 세션 저장소 | 서버 메모리에 두면 다른 서버로 가는 순간 로그아웃된다 |
| 레이트 리밋 카운터 | 서버별로 세면 서버 수만큼 한도가 늘어난다 (→ `03-resilience.md`) |
| 분산 락 | "이 잡은 한 서버만 돌려라" |
| SignalR 백플레인 | 서버 A 에 붙은 사용자에게 서버 B 가 메시지를 보낼 때 |
| 간단한 큐 | 정식 큐(Service Bus)를 쓰기 전 단계 |

**Redis 는 DB 가 아니다.** 설정에 따라 재시작 시 데이터가 사라질 수 있다. **잃어도 DB 에서 다시 만들 수 있는 것만** 넣는다.

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

**`no-cache` 는 "캐시하지 마"가 아니다.** 이름이 헷갈리는 대표적인 헤더다. 저장 금지는 `no-store`.
로그인 사용자 API 에 `public` 이 붙어 CDN 에 캐시되면, 4절과 똑같은 사고가 CDN 에서 난다.

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

## 스스로 답해보기

1. 서버 3대에서 `IMemoryCache` 를 쓰면 사용자가 무엇을 보게 되나?
2. 수정 API 에서 캐시를 새 값으로 갱신하지 않고 삭제하는 이유는?
3. 무효화 코드가 있는데도 TTL 을 거는 이유는?
4. 캐시 키가 `dashboard:stats` 다. 멀티테넌트 서비스에서 무슨 일이 일어나나? 왜 테스트에서 안 잡히나?
5. 인기 키가 만료되는 순간 DB 가 죽었다. 무슨 현상이고 어떻게 막나?
6. `Cache-Control: no-cache` 와 `no-store` 의 차이는?
7. Redis 에 넣으면 안 되는 데이터는?
