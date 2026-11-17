using GpsSystem.Api.Models;

namespace GpsSystem.Api.Services;

public interface IViajeService
{
    Task<SolicitudViajeResponse> SolicitarAsync(string pasajeroId, SolicitarViajeRequest request, CancellationToken cancellationToken);

    Task<ViajeResponse> AceptarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken);

    Task RechazarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken);

    Task<ViajeResponse> MarcarLlegandoAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken);

    Task<ViajeResponse> CancelarAsync(
        Guid viajeId,
        string usuarioId,
        CancellationToken cancellationToken);

    Task<ViajeResponse> IniciarAsync(Guid viajeId, string conductorId, string pin, CancellationToken cancellationToken);

    Task<FinalizacionViajeResponse> FinalizarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken);

    Task<ViajeResponse> ConfirmarPagoRecibidoAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken);

    Task<decimal> ObtenerGananciasAsync(string conductorId, CancellationToken cancellationToken);

    Task<IReadOnlyList<HistorialViajeConductorResponse>> ObtenerHistorialConductorAsync(
        string conductorId,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<HistorialViajePasajeroResponse>> ObtenerHistorialPasajeroAsync(
        string pasajeroId,
        CancellationToken cancellationToken);

    Task<EstadisticasPasajeroResponse> ObtenerEstadisticasPasajeroAsync(
        string pasajeroId,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ViajeResponse>> ObtenerDisponiblesAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<ViajeResponse>> ObtenerPropiosAsync(string usuarioId, string rol, CancellationToken cancellationToken);

    Task<IReadOnlyList<ViajeResponse>> ObtenerHistorialAsync(string usuarioId, CancellationToken cancellationToken);

    Task<ViajeResponse?> ObtenerAsync(Guid viajeId, string usuarioId, CancellationToken cancellationToken);

    Task<ViajeResponse> CalificarAsync(
        Guid viajeId,
        string pasajeroId,
        CalificarViajeRequest request,
        CancellationToken cancellationToken);
}
