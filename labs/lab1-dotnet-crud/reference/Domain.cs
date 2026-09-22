using System.ComponentModel.DataAnnotations;

namespace PetClinic.Api;

// ─── 엔티티: DB 테이블의 모양 ───────────────────────────────
// class 를 쓴다. EF Core 가 변경 추적을 하려면 가변(mutable)이어야 하기 때문.

public class Owner
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Phone { get; set; } = "";
    public List<Pet> Pets { get; set; } = [];        // 네비게이션 프로퍼티
}

public class Pet
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Species { get; set; } = "";
    public DateOnly? BirthDate { get; set; }

    public string? InternalMemo { get; set; }        // 내부용 — DTO 에 내보내지 않는다
    public bool IsDeleted { get; set; }              // 소프트 삭제 (글로벌 쿼리 필터 실습용)
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Guid OwnerId { get; set; }
    public Owner Owner { get; set; } = null!;
}

// ─── DTO: API 의 모양 ──────────────────────────────────────
// record 를 쓴다. 불변이고 값 비교가 되고 한 줄로 끝난다.
// 엔티티를 그대로 내보내면 ① 내부 필드 노출 ② 순환 참조 ③ DB 스키마 = API 계약 이 된다.

public record PetDto(Guid Id, string Name, string Species, DateOnly? BirthDate, string OwnerName);

public record OwnerDto(Guid Id, string Name, string Phone);

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int Size, int Total);

// 요청 DTO 에는 '클라이언트가 정해도 되는 값'만 둔다.
// Id 나 TenantId 를 여기 두면 클라이언트가 그걸 채워 보낼 수 있다 (over-posting 취약점).
public record CreatePetRequest(
    [Required, StringLength(50, MinimumLength = 1)] string Name,
    [Required, StringLength(30)] string Species,
    DateOnly? BirthDate,
    [Required] Guid OwnerId);

public record CreateOwnerRequest(
    [Required, StringLength(50)] string Name,
    [Required, StringLength(20)] string Phone);

// ─── 도메인 예외 ───────────────────────────────────────────
// 서비스 계층은 HTTP 를 모른다. 예외를 던지고, 한 곳에서 상태코드로 변환한다.

public class NotFoundException(string message) : Exception(message);
public class ConflictException(string message) : Exception(message);
public class DomainValidationException(string message) : Exception(message);
