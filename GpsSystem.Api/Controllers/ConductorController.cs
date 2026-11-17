using System.Security.Claims;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Authorize(Roles = RolesUsuario.Conductor)]
[Route("api/conductor")]
public sealed class ConductorController(
    UserManager<Usuario> userManager,
    IDocumentoConductorStorage documentoStorage,
    ILogger<ConductorController> logger) : ControllerBase
{
    [HttpPost("subir-documento")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(11_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 11_000_000)]
    [ProducesResponseType<EstadoVerificacionConductorResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<EstadoVerificacionConductorResponse>> SubirDocumento(
        [FromForm] SubirDocumentoConductorRequest request,
        CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<TipoDocumentoConductor>(
                request.TipoDocumento,
                ignoreCase: false,
                out var tipoDocumento)
            || !Enum.IsDefined(tipoDocumento))
        {
            return BadRequest(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "El tipo de documento no es válido."
            });
        }

        var usuarioId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(usuarioId))
        {
            return Unauthorized();
        }

        var usuario = await userManager.FindByIdAsync(usuarioId);
        if (usuario is null)
        {
            return NotFound();
        }

        var claveNueva = await documentoStorage.GuardarAsync(request.Archivo, cancellationToken);
        var claveAnterior = ObtenerClave(usuario, tipoDocumento);
        EstablecerClave(usuario, tipoDocumento, claveNueva);
        usuario.EstadoVerificacion = EstadoVerificacionConductor.Pendiente;
        usuario.MotivoRechazo = null;
        usuario.FechaVencimientoDocumentos = null;

        var resultado = await userManager.UpdateAsync(usuario);
        if (!resultado.Succeeded)
        {
            await EliminarConAvisoAsync(claveNueva, cancellationToken);
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "No se pudo guardar el documento en el perfil.",
                detail: string.Join("; ", resultado.Errors.Select(error => error.Description)));
        }

        if (!string.Equals(claveAnterior, claveNueva, StringComparison.Ordinal))
        {
            await EliminarConAvisoAsync(claveAnterior, cancellationToken);
        }

        return Ok(CrearRespuesta(usuario));
    }

    [HttpPost("enviar-verificacion")]
    [ProducesResponseType<EstadoVerificacionConductorResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<EstadoVerificacionConductorResponse>> EnviarVerificacion(
        CancellationToken cancellationToken)
    {
        var usuarioId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(usuarioId))
        {
            return Unauthorized();
        }

        var usuario = await userManager.FindByIdAsync(usuarioId);
        if (usuario is null)
        {
            return NotFound();
        }

        var documentosPresentes =
            await documentoStorage.ExisteAsync(usuario.UrlLicencia, cancellationToken)
            && await documentoStorage.ExisteAsync(usuario.UrlSOAT, cancellationToken)
            && await documentoStorage.ExisteAsync(usuario.UrlTarjetaPropiedad, cancellationToken);
        if (!documentosPresentes)
        {
            return BadRequest(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Debes subir los tres documentos antes de enviar la verificación."
            });
        }

        usuario.EstadoVerificacion = EstadoVerificacionConductor.Pendiente;
        usuario.MotivoRechazo = null;
        usuario.FechaVencimientoDocumentos = null;
        var resultado = await userManager.UpdateAsync(usuario);
        if (!resultado.Succeeded)
        {
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "No se pudo enviar la solicitud de verificación.",
                detail: string.Join("; ", resultado.Errors.Select(error => error.Description)));
        }

        return Ok(CrearRespuesta(usuario));
    }

    private async Task EliminarConAvisoAsync(string? clave, CancellationToken cancellationToken)
    {
        try
        {
            await documentoStorage.EliminarAsync(clave, cancellationToken);
        }
        catch (IOException exception)
        {
            logger.LogWarning(exception, "No se pudo limpiar el archivo local {Clave}.", clave);
        }
    }

    private static string? ObtenerClave(Usuario usuario, TipoDocumentoConductor tipoDocumento) =>
        tipoDocumento switch
        {
            TipoDocumentoConductor.Licencia => usuario.UrlLicencia,
            TipoDocumentoConductor.SOAT => usuario.UrlSOAT,
            TipoDocumentoConductor.TarjetaPropiedad => usuario.UrlTarjetaPropiedad,
            _ => null
        };

    private static void EstablecerClave(
        Usuario usuario,
        TipoDocumentoConductor tipoDocumento,
        string clave)
    {
        switch (tipoDocumento)
        {
            case TipoDocumentoConductor.Licencia:
                usuario.UrlLicencia = clave;
                break;
            case TipoDocumentoConductor.SOAT:
                usuario.UrlSOAT = clave;
                break;
            case TipoDocumentoConductor.TarjetaPropiedad:
                usuario.UrlTarjetaPropiedad = clave;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(tipoDocumento), tipoDocumento, null);
        }
    }

    private static EstadoVerificacionConductorResponse CrearRespuesta(Usuario usuario) =>
        new(
            usuario.EstadoVerificacion.ToString(),
            usuario.MotivoRechazo,
            usuario.UrlLicencia is not null,
            usuario.UrlSOAT is not null,
            usuario.UrlTarjetaPropiedad is not null,
            usuario.FechaVencimientoDocumentos);
}
