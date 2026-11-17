namespace GpsSystem.Api.Models;

public class ParadaViaje
{
    public int Id { get; set; }

    public Guid ViajeId { get; set; }

    public double Latitud { get; set; }

    public double Longitud { get; set; }

    public int Orden { get; set; }

    public Viaje Viaje { get; set; } = null!;
}
