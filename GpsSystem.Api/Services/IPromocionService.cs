using GpsSystem.Api.Models;

namespace GpsSystem.Api.Services;

public interface IPromocionService
{
    Task<Promocion?> ObtenerValidaAsync(string codigo, CancellationToken cancellationToken);

    Task<PromocionResponse> CrearAsync(
        CrearPromocionRequest request,
        CancellationToken cancellationToken);

    Task<PromocionResponse?> ObtenerPorIdAsync(Guid id, CancellationToken cancellationToken);
}
