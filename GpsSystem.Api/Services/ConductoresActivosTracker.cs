using System.Collections.Concurrent;

namespace GpsSystem.Api.Services;

public interface IConductoresActivosTracker
{
    int TotalConductoresActivos { get; }

    void EstablecerDisponibilidad(string connectionId, string usuarioId, bool disponible);

    void Desconectar(string connectionId);
}

public sealed class ConductoresActivosTracker : IConductoresActivosTracker
{
    private readonly ConcurrentDictionary<string, string> _conexionesDisponibles = new();

    public int TotalConductoresActivos =>
        _conexionesDisponibles.Values.Distinct(StringComparer.Ordinal).Count();

    public void EstablecerDisponibilidad(string connectionId, string usuarioId, bool disponible)
    {
        if (disponible)
        {
            _conexionesDisponibles[connectionId] = usuarioId;
        }
        else
        {
            Desconectar(connectionId);
        }
    }

    public void Desconectar(string connectionId) =>
        _conexionesDisponibles.TryRemove(connectionId, out _);
}
