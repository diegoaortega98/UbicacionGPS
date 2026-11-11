using GpsSystem.Api.Models;

namespace GpsSystem.Api.Services;

public interface IViajeService
{
    Task<SolicitudViajeResponse> SolicitarAsync(string pasajeroId, SolicitarViajeRequest request, CancellationToken cancellationToken);

    Task<ViajeResponse> AceptarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken);

    Task<ViajeResponse> IniciarAsync(Guid viajeId, string conductorId, string pin, CancellationToken cancellationToken);

    Task<ViajeResponse> FinalizarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken);

    Task<IReadOnlyList<ViajeResponse>> ObtenerDisponiblesAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<ViajeResponse>> ObtenerPropiosAsync(string usuarioId, string rol, CancellationToken cancellationToken);

    Task<ViajeResponse?> ObtenerAsync(Guid viajeId, string usuarioId, CancellationToken cancellationToken);
}
