# 실습 1 — ASP.NET Core + EF Core CRUD API

**목표: "C# 공부했다"가 아니라 "만들어봤다"가 되는 것.**
하루면 충분하고, 이 하루가 입사 첫 주의 속도를 완전히 바꾼다.

> ⚠️ **이 실습 코드는 이 환경에서 실행 검증하지 않았다** (작성 시점에 로컬에 `dotnet` 이 없었다).
> 오타나 버전 차이로 컴파일 에러가 날 수 있다. **그건 문제가 아니라 실습의 일부다** —
> 에러 메시지를 읽고 고치는 것이 .NET 에 익숙해지는 가장 빠른 길이다.
> 막히면 Claude 에게 에러를 그대로 붙여넣어라.

---

## 0. 준비

```bash
brew install --cask dotnet-sdk
dotnet --version          # 9.x 이상
dotnet tool install --global dotnet-ef
```

**DB 는 SQLite 를 쓴다.** Docker 도 Postgres 도 필요 없다. 파일 하나로 끝난다.
(회사는 PostgreSQL/MSSQL 을 쓰지만, EF Core 코드는 연결 문자열만 다르고 거의 같다)

---

## 1. 프로젝트 만들기

```bash
mkdir -p ~/petclinic && cd ~/petclinic
dotnet new webapi -n PetClinic.Api
cd PetClinic.Api

dotnet add package Microsoft.EntityFrameworkCore.Sqlite
dotnet add package Microsoft.EntityFrameworkCore.Design

dotnet run       # http://localhost:5xxx/openapi/v1.json 이 뜨면 성공
```

포트는 `Properties/launchSettings.json` 에 있다. 아래에서는 `5000` 이라고 가정한다.

---

## 2. 코드 작성

`reference/` 폴더의 파일들을 프로젝트에 복사하거나, 보면서 직접 쳐라.
**직접 치는 걸 권한다.** IDE 자동완성이 뜨는 걸 보는 것 자체가 학습이다.

| 파일 | 내용 | 관련 문서 |
| --- | --- | --- |
| `Domain.cs` | 엔티티 (Pet, Owner) + DTO (record) | `02-csharp-dotnet/01` 의 record |
| `AppDbContext.cs` | DbContext, Fluent API 매핑, 글로벌 쿼리 필터 | `02-csharp-dotnet/03` |
| `PetService.cs` | 업무 규칙 + 커스텀 예외 | `01-backend-basics/02` |
| `Program.cs` | DI 등록 + 미들웨어 + 엔드포인트 | `01-backend-basics/01` |

복사 후:

```bash
dotnet build                                  # 컴파일 = 타입 검증
dotnet ef migrations add InitialCreate        # 마이그레이션 생성
dotnet ef migrations script                   # 어떤 SQL 이 나가는지 눈으로 확인 ← 습관을 들여라
dotnet ef database update                     # petclinic.db 파일 생성
dotnet watch run                              # 핫 리로드로 실행
```

---

## 3. 동작 확인

```bash
BASE=http://localhost:5000

# 보호자 생성
curl -s -X POST $BASE/api/owners -H 'Content-Type: application/json' \
  -d '{"name":"김철수","phone":"010-1234-5678"}' | tee /tmp/owner.json

OWNER=$(python3 -c "import json;print(json.load(open('/tmp/owner.json'))['id'])")

# 펫 생성 (201 + Location 헤더 확인)
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d "{\"name\":\"코코\",\"species\":\"dog\",\"birthDate\":\"2022-03-01\",\"ownerId\":\"$OWNER\"}"

# 목록 (페이지네이션)
curl -s "$BASE/api/pets?page=1&size=10" | python3 -m json.tool

# 중복 생성 → 409 Conflict
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d "{\"name\":\"코코\",\"species\":\"dog\",\"birthDate\":\"2022-03-01\",\"ownerId\":\"$OWNER\"}"

# 검증 실패 → 400 + 필드별 에러
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d '{"name":"","species":"dog"}'

# 없는 것 → 404
curl -i $BASE/api/pets/00000000-0000-0000-0000-000000000000

# 미래 생년월일 → 400 (업무 규칙 검증)
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d "{\"name\":\"미래\",\"species\":\"cat\",\"birthDate\":\"2030-01-01\",\"ownerId\":\"$OWNER\"}"
```

**상태코드를 하나하나 눈으로 확인해라.** 201/400/404/409 를 코드가 어디서 만드는지 찾아보는 게 핵심이다.

---

## 4. 반드시 해볼 것 — 여기가 진짜 실습

### ① SQL 을 눈으로 본다

`Program.cs` 에 이미 로깅이 켜져 있다. 목록 API 를 한 번 호출하고 콘솔을 봐라.

```
info: Microsoft.EntityFrameworkCore.Database.Command[20101]
      Executed DbCommand ... SELECT "p"."Id", "p"."Name", ... FROM "Pets" AS "p" ...
```

**LINQ 가 SQL 로 번역되는 걸 직접 보는 것.** 이게 EF Core 를 이해하는 유일한 방법이다.

### ② N+1 을 직접 만들어 본다

`PetService.ListAsync` 의 Projection 을 이렇게 바꿔라.

```csharp
// 바꾸기 전 (좋은 것)
.Select(p => new PetDto(p.Id, p.Name, p.Species, p.BirthDate, p.Owner.Name))

// 바꾼 후 (N+1 을 만든다)
var pets = await query.ToListAsync(ct);
var dtos = new List<PetDto>();
foreach (var p in pets)
{
    var owner = await db.Owners.FindAsync([p.OwnerId], ct);   // ← 마리마다 쿼리
    dtos.Add(new PetDto(p.Id, p.Name, p.Species, p.BirthDate, owner!.Name));
}
```

펫을 20마리쯤 만들어 두고 목록을 호출하면, **콘솔에 SELECT 가 21번** 찍힌다.
이걸 한 번 보고 나면 N+1 을 절대 잊지 않는다.

### ③ `AsNoTracking()` 을 빼본다

목록 조회에서 빼고, 그 다음 `SaveChangesAsync()` 를 부르는 코드를 넣어보면
의도치 않은 UPDATE 가 나가는 걸 만들 수 있다.

### ④ 글로벌 쿼리 필터를 확인한다

`AppDbContext` 에 `HasQueryFilter(p => !p.IsDeleted)` 가 있다.
소프트 삭제된 펫이 목록에 안 나오는지, 그리고 **SQL 에 `WHERE NOT IsDeleted` 가 자동으로 붙는지** 확인해라.
`IgnoreQueryFilters()` 로 우회할 수 있다는 것도 확인.

> 멀티테넌시의 `tenant_id` 필터가 정확히 이 메커니즘이다.

### ⑤ 마이그레이션을 하나 더 만들어 본다

`Pet` 에 `public string? Memo { get; set; }` 를 추가하고:

```bash
dotnet ef migrations add AddPetMemo
dotnet ef migrations script AddPetMemo      # 이전 마이그레이션 이후의 SQL 만
dotnet ef database update
```

생성된 마이그레이션 파일의 `Up()` / `Down()` 을 읽어봐라.

### ⑥ 테스트를 붙인다

```bash
cd ~/petclinic
dotnet new xunit -n PetClinic.Tests
cd PetClinic.Tests
dotnet add reference ../PetClinic.Api
dotnet add package Microsoft.AspNetCore.Mvc.Testing
dotnet add package Microsoft.EntityFrameworkCore.InMemory
dotnet test
```

`reference/PetApiTests.cs` 참고. `WebApplicationFactory<Program>` 으로 **앱 전체를 메모리에 띄워
실제 HTTP 요청을 보내는 테스트**를 해본다. 프론트로 치면 E2E 신뢰도를 단위 테스트 속도로 얻는 것.

---

## 5. 추가 과제 (여유 있으면)

| 난이도 | 과제 |
| --- | --- |
| ★ | `PUT /api/pets/{id}` 수정 엔드포인트 추가 |
| ★ | 검색 필터 추가 (`?species=dog&q=코코`) — `IQueryable` 에 조건을 쌓는 연습 |
| ★★ | 커서 기반 페이지네이션으로 바꾸기 |
| ★★ | `RowVersion` 으로 낙관적 동시성 → `DbUpdateConcurrencyException` → 409 |
| ★★ | `X-Tenant-Id` 헤더를 읽는 미들웨어 + `tenant_id` 글로벌 쿼리 필터 |
| ★★★ | SQLite → PostgreSQL 로 교체 (`Npgsql.EntityFrameworkCore.PostgreSQL`, docker 로 DB 기동) |
| ★★★ | 오래 걸리는 작업 API — `202 Accepted` + 잡 상태 폴링 (`01-backend-basics/05`) |
| ★★★ | SSE 엔드포인트 — 1초에 한 글자씩 흘려보내기 (`05-realtime-ui/01`) |

마지막 두 개는 **랭코드에서 실제로 할 일과 가장 가깝다.** 시간이 있으면 여기까지 가라.

---

## 6. 끝나고 스스로 답해보기

1. `builder.Services.AddScoped` 와 `AddSingleton` 을 바꾸면 어디서 터지나?
2. `Include` 와 `Select` 중 뭘 썼고, SQL 이 어떻게 달랐나?
3. 409 를 만드는 코드는 어느 계층에 있나? 왜 거기인가?
4. `dotnet ef migrations script` 로 본 SQL 에서 인덱스가 어디에 생겼나?
5. 마이그레이션을 되돌리려면? 되돌릴 수 없는 마이그레이션은 어떤 것인가?
