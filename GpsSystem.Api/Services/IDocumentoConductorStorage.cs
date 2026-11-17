using Microsoft.AspNetCore.Http;

namespace GpsSystem.Api.Services;

public interface IDocumentoConductorStorage
{
    Task<string> GuardarAsync(IFormFile archivo, CancellationToken cancellationToken);

    Task<DocumentoConductorArchivo?> AbrirAsync(string? clave, CancellationToken cancellationToken);

    Task EliminarAsync(string? clave, CancellationToken cancellationToken);

    Task<bool> ExisteAsync(string? clave, CancellationToken cancellationToken);
}

public sealed record DocumentoConductorArchivo(Stream Contenido, string ContentType, string NombreArchivo);
