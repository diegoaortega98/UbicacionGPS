using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public class Dispositivo
{
    [Key]
    [MaxLength(100)]
    public string Id { get; set; } = string.Empty;

    [MaxLength(150)]
    public string Nombre { get; set; } = string.Empty;

    public DateTime CreadoEn { get; set; } = DateTime.UtcNow;

    public ICollection<Ubicacion> Ubicaciones { get; set; } = new List<Ubicacion>();
}
