using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Services;

public sealed class PromocionService(AppDbContext dbContext) : IPromocionService
{
    public Task<Promocion?> ObtenerValidaAsync(string codigo, CancellationToken cancellationToken)
    {
        var codigoNormalizado = NormalizarCodigo(codigo);
        var ahora = DateTime.UtcNow;
        return dbContext.Promociones.AsNoTracking()
            .FirstOrDefaultAsync(promocion =>
                promocion.Codigo == codigoNormalizado
                && promocion.EstaActiva
                && (promocion.FechaExpiracion == null || promocion.FechaExpiracion > ahora),
                cancellationToken);
    }

    public async Task<PromocionResponse> CrearAsync(
        CrearPromocionRequest request,
        CancellationToken cancellationToken)
    {
        var codigo = NormalizarCodigo(request.Codigo);
        if (await dbContext.Promociones.AnyAsync(
                promocion => promocion.Codigo == codigo,
                cancellationToken))
        {
            throw new InvalidOperationException("Ya existe una promoción con ese código.");
        }

        if (request.FechaExpiracion is DateTimeOffset expiration
            && expiration <= DateTimeOffset.UtcNow)
        {
            throw new ArgumentException("La fecha de expiración debe estar en el futuro.");
        }

        var promocion = new Promocion
        {
            Codigo = codigo,
            PorcentajeDescuento = request.PorcentajeDescuento,
            EstaActiva = true,
            FechaExpiracion = request.FechaExpiracion?.UtcDateTime
        };
        dbContext.Promociones.Add(promocion);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Mapear(promocion);
    }

    public async Task<PromocionResponse?> ObtenerPorIdAsync(
        Guid id,
        CancellationToken cancellationToken)
    {
        var promocion = await dbContext.Promociones.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        return promocion is null ? null : Mapear(promocion);
    }

    private static string NormalizarCodigo(string codigo) => codigo.Trim().ToUpperInvariant();

    private static PromocionResponse Mapear(Promocion promocion) =>
        new(
            promocion.Id,
            promocion.Codigo,
            promocion.PorcentajeDescuento,
            promocion.EstaActiva,
            promocion.FechaExpiracion is DateTime expiration
                ? new DateTimeOffset(DateTime.SpecifyKind(expiration, DateTimeKind.Utc))
                : null);
}
