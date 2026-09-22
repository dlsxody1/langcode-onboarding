using Microsoft.EntityFrameworkCore;

namespace PetClinic.Api;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Pet> Pets => Set<Pet>();
    public DbSet<Owner> Owners => Set<Owner>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Owner>(e =>
        {
            e.ToTable("owners");
            e.HasKey(o => o.Id);
            e.Property(o => o.Name).HasMaxLength(50).IsRequired();
            e.Property(o => o.Phone).HasMaxLength(20).IsRequired();
        });

        b.Entity<Pet>(e =>
        {
            e.ToTable("pets");
            e.HasKey(p => p.Id);
            e.Property(p => p.Name).HasMaxLength(50).IsRequired();
            e.Property(p => p.Species).HasMaxLength(30).IsRequired();

            // 복합 인덱스 — 순서에 의미가 있다.
            // (OwnerId, Name) 은 "이 보호자의 이 이름" 중복 검사와 보호자별 목록 조회에 쓰인다.
            e.HasIndex(p => new { p.OwnerId, p.Name });

            e.HasOne(p => p.Owner)
             .WithMany(o => o.Pets)
             .HasForeignKey(p => p.OwnerId)
             .OnDelete(DeleteBehavior.Restrict);   // 펫이 있는 보호자는 못 지운다

            // ── 글로벌 쿼리 필터 ──
            // 이 엔티티에 대한 모든 쿼리에 자동으로 WHERE NOT IsDeleted 가 붙는다.
            // 멀티테넌시의 tenant_id 필터도 정확히 이 메커니즘을 쓴다.
            // 사람이 매번 기억해야 하는 규칙은 결국 빠진다 → 프레임워크가 강제하게 만든다.
            e.HasQueryFilter(p => !p.IsDeleted);
        });
    }
}
