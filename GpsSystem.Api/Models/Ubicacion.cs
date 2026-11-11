using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public class Ubicacion
{
    public long Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string DispositivoId { get; set; } = string.Empty;

    public double Latitud { get; set; }

    public double Longitud { get; set; }

    public double Velocidad { get; set; }

    public DateTime FechaHora { get; set; }

    public Dispositivo Dispositivo { get; set; } = null!;
}
