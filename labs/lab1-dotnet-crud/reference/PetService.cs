using Microsoft.EntityFrameworkCore;

namespace PetClinic.Api;

public interface IPetService
{
    Task<PetDto?> GetAsync(Guid id, CancellationToken ct);
    Task<PagedResult<PetDto>> ListAsync(int page, int size, string? species, CancellationToken ct);
    Task<PetDto> CreateAsync(CreatePetRequest req, CancellationToken ct);
    Task DeleteAsync(Guid id, CancellationToken ct);
}

public class PetService(AppDbContext db, ILogger<PetService> logger) : IPetService
{
    public async Task<PetDto?> GetAsync(Guid id, CancellationToken ct) =>
        await db.Pets
            .AsNoTracking()                                     // 읽기 전용 → 변경 추적 불필요
            .Where(p => p.Id == id)
            .Select(p => new PetDto(p.Id, p.Name, p.Species, p.BirthDate, p.Owner.Name))
            .FirstOrDefaultAsync(ct);                           // First 가 아니라 FirstOrDefault

    public async Task<PagedResult<PetDto>> ListAsync(
        int page, int size, string? species, CancellationToken ct)
    {
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);                        // 무제한 조회 방지

        // IQueryable 인 동안은 SQL 이 안 나간다. 조건을 쌓다가 ToListAsync 에서 한 번에 실행.
        var q = db.Pets.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(species))
            q = q.Where(p => p.Species == species);

        var total = await q.CountAsync(ct);

        var items = await q
            .OrderByDescending(p => p.CreatedAt)
            .ThenBy(p => p.Id)                                  // 타이브레이커 — 없으면 페이지 간 중복
            .Skip((page - 1) * size)
            .Take(size)
            // Projection: 필요한 컬럼만 SELECT. Include 없이 Owner.Name 을 가져온다 (JOIN 1번)
            .Select(p => new PetDto(p.Id, p.Name, p.Species, p.BirthDate, p.Owner.Name))
            .ToListAsync(ct);

        return new PagedResult<PetDto>(items, page, size, total);
    }

    public async Task<PetDto> CreateAsync(CreatePetRequest req, CancellationToken ct)
    {
        // ── 업무 규칙은 서비스 계층에 산다 (컨트롤러도 리포지토리도 아니다) ──

        // 규칙 1: 보호자가 존재해야 한다
        var owner = await db.Owners.FirstOrDefaultAsync(o => o.Id == req.OwnerId, ct)
            ?? throw new NotFoundException($"보호자 {req.OwnerId} 를 찾을 수 없습니다.");

        // 규칙 2: 생년월일이 미래일 수 없다
        if (req.BirthDate is { } bd && bd > DateOnly.FromDateTime(DateTime.UtcNow))
            throw new DomainValidationException("생년월일이 미래입니다.");

        // 규칙 3: 같은 보호자에게 같은 이름의 펫은 중복 등록 불가
        if (await db.Pets.AnyAsync(p => p.OwnerId == req.OwnerId && p.Name == req.Name, ct))
            throw new ConflictException($"'{req.Name}' 은(는) 이미 등록된 이름입니다.");

        var pet = new Pet
        {
            Id = Guid.NewGuid(),
            Name = req.Name,
            Species = req.Species,
            BirthDate = req.BirthDate,
            OwnerId = req.OwnerId,
        };

        db.Pets.Add(pet);
        await db.SaveChangesAsync(ct);          // 여기서 한 트랜잭션으로 반영된다

        logger.LogInformation("펫 등록 {PetId} (보호자 {OwnerId})", pet.Id, owner.Id);
        return new PetDto(pet.Id, pet.Name, pet.Species, pet.BirthDate, owner.Name);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var pet = await db.Pets.FirstOrDefaultAsync(p => p.Id == id, ct)
            ?? throw new NotFoundException($"펫 {id} 를 찾을 수 없습니다.");

        pet.IsDeleted = true;                   // 소프트 삭제 — 글로벌 쿼리 필터가 가려준다
        await db.SaveChangesAsync(ct);          // db.Update() 를 부를 필요가 없다 (변경 추적)
    }
}
