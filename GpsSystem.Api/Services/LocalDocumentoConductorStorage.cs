using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace GpsSystem.Api.Services;

public sealed class LocalDocumentoConductorStorage : IDocumentoConductorStorage
{
    private const long TamanoMaximoBytes = 10 * 1024 * 1024;
    private readonly string _directorio;

    public LocalDocumentoConductorStorage(IWebHostEnvironment environment)
    {
        // Replace this local storage adapter with Cloudinary/S3 for persistent production storage.
        _directorio = Path.Combine(environment.ContentRootPath, "App_Data", "uploads");
    }

    public async Task<string> GuardarAsync(IFormFile archivo, CancellationToken cancellationToken)
    {
        if (archivo.Length is <= 0 or > TamanoMaximoBytes)
        {
            throw new ArgumentException("El archivo debe tener un tamaño máximo de 10 MB.");
        }

        var extension = Path.GetExtension(archivo.FileName).ToLowerInvariant();
        if (extension is not (".pdf" or ".jpg" or ".jpeg" or ".png"))
        {
            throw new ArgumentException("Solo se permiten archivos PDF, JPG o PNG.");
        }

        await using (var stream = archivo.OpenReadStream())
        {
            var firma = new byte[8];
            var leidos = 0;
            while (leidos < firma.Length)
            {
                var cantidad = await stream.ReadAsync(firma.AsMemory(leidos), cancellationToken);
                if (cantidad == 0)
                {
                    break;
                }

                leidos += cantidad;
            }

            if (!FirmaValida(extension, firma, leidos))
            {
                throw new ArgumentException("El contenido no coincide con un PDF, JPG o PNG válido.");
            }
        }

        Directory.CreateDirectory(_directorio);
        var clave = $"{Guid.NewGuid():N}{extension}";
        var ruta = Path.Combine(_directorio, clave);
        var guardado = false;
        try
        {
            await using var destino = new FileStream(
                ruta,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            await using var origen = archivo.OpenReadStream();
            await origen.CopyToAsync(destino, cancellationToken);
            guardado = true;
            return clave;
        }
        finally
        {
            if (!guardado && File.Exists(ruta))
            {
                File.Delete(ruta);
            }
        }
    }

    public Task<DocumentoConductorArchivo?> AbrirAsync(
        string? clave,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var ruta = ObtenerRuta(clave);
        if (ruta is null || !File.Exists(ruta))
        {
            return Task.FromResult<DocumentoConductorArchivo?>(null);
        }

        var contenido = new FileStream(
            ruta,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            81920,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var documento = new DocumentoConductorArchivo(
            contenido,
            ObtenerContentType(Path.GetExtension(ruta)),
            Path.GetFileName(ruta));
        return Task.FromResult<DocumentoConductorArchivo?>(documento);
    }

    public Task EliminarAsync(string? clave, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var ruta = ObtenerRuta(clave);
        if (ruta is not null && File.Exists(ruta))
        {
            File.Delete(ruta);
        }

        return Task.CompletedTask;
    }

    public Task<bool> ExisteAsync(string? clave, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var ruta = ObtenerRuta(clave);
        return Task.FromResult(ruta is not null && File.Exists(ruta));
    }

    private string? ObtenerRuta(string? clave)
    {
        if (string.IsNullOrWhiteSpace(clave)
            || !string.Equals(Path.GetFileName(clave), clave, StringComparison.Ordinal)
            || !Guid.TryParseExact(Path.GetFileNameWithoutExtension(clave), "N", out _)
            || Path.GetExtension(clave).ToLowerInvariant() is not (".pdf" or ".jpg" or ".jpeg" or ".png"))
        {
            return null;
        }

        return Path.Combine(_directorio, clave);
    }

    private static bool FirmaValida(string extension, byte[] firma, int bytesLeidos) =>
        extension switch
        {
            ".pdf" => bytesLeidos >= 5
                && firma[0] == 0x25 && firma[1] == 0x50 && firma[2] == 0x44
                && firma[3] == 0x46 && firma[4] == 0x2D,
            ".jpg" or ".jpeg" => bytesLeidos >= 3
                && firma[0] == 0xFF && firma[1] == 0xD8 && firma[2] == 0xFF,
            ".png" => bytesLeidos >= 8
                && firma[0] == 0x89 && firma[1] == 0x50 && firma[2] == 0x4E && firma[3] == 0x47
                && firma[4] == 0x0D && firma[5] == 0x0A && firma[6] == 0x1A && firma[7] == 0x0A,
            _ => false
        };

    private static string ObtenerContentType(string extension) =>
        extension.ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            _ => "application/octet-stream"
        };
}
