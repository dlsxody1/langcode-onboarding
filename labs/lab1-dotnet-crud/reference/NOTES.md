# reference 코드에 대한 메모

## `.WithParameterValidation()` 이 컴파일 안 되면

Minimal API 의 DataAnnotations 자동 검증은 .NET 버전에 따라 제공 방식이 다르다.

- **.NET 10+**: 내장. `builder.Services.AddValidation()` 등록 후 사용 가능
- **그 이전**: `MinimalApis.Extensions` 패키지를 설치하거나, 아래처럼 직접 검증

```csharp
// 그 줄을 지우고, 핸들러 안에서 직접
using System.ComponentModel.DataAnnotations;

var ctx = new ValidationContext(req);
var results = new List<ValidationResult>();
if (!Validator.TryValidateObject(req, ctx, results, validateAllProperties: true))
    return Results.ValidationProblem(
        results.ToDictionary(r => r.MemberNames.FirstOrDefault() ?? "", r => new[] { r.ErrorMessage ?? "" }));
```

**컨트롤러 방식(`[ApiController]`)에서는 이게 전부 자동이다.** 이게 컨트롤러를 쓰는 이유 중 하나다.

## `AddOpenApi()` 가 없다고 나오면

.NET 9 부터의 API 다. .NET 8 이하라면:

```bash
dotnet add package Swashbuckle.AspNetCore
```
```csharp
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
// ...
app.UseSwagger();
app.UseSwaggerUI();
```

## `public partial class Program;` 이 왜 필요한가

Minimal API 는 top-level statements 로 작성되어 `Program` 클래스가 `internal` 로 생성된다.
테스트 프로젝트에서 `WebApplicationFactory<Program>` 을 쓰려면 public 이어야 한다.

## SQLite 의 한계

- `DateOnly` 매핑이 버전에 따라 다를 수 있다. 문제가 생기면 `DateTime` 으로 바꿔라
- `RowVersion` (낙관적 동시성) 은 SQLite 에서 기본 지원이 안 된다. PostgreSQL 로 바꾼 뒤 실습
- 동시성·격리 수준 실습도 SQLite 로는 제한적이다

**회사 스택(PostgreSQL/MSSQL)과 다른 건 연결 문자열과 프로바이더뿐이다.** EF Core 코드는 거의 같다.
