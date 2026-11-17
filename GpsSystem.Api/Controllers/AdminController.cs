using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
public sealed class AdminController(
    AppDbContext dbContext,
    IConductoresActivosTracker conductoresActivos,
    IPromocionService promocionService,
    UserManager<Usuario> userManager,
    IDocumentoConductorStorage documentoStorage) : ControllerBase
{
    [HttpGet("estadisticas")]
    [ProducesResponseType<AdminEstadisticasResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<AdminEstadisticasResponse>> ObtenerEstadisticas(
        CancellationToken cancellationToken)
    {
        if (!User.IsInRole(RolesUsuario.Admin))
        {
            return Forbid();
        }

        var viajesFinalizados = dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.Estado == EstadosViaje.Finalizado);
        var inicioHoyUtc = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        var finHoyUtc = inicioHoyUtc.AddDays(1);
        long totalViajes;
        decimal comisionesTotales;
        decimal comisionesRecibidas;
        decimal comisionesPorCobrarEfectivo;
        long viajesHoy;
        decimal recaudadoHoy;
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var fechasYComisiones = await viajesFinalizados
                .Select(viaje => new
                {
                    viaje.FechaFinalizacion,
                    viaje.ComisionPlataforma,
                    viaje.MetodoPago
                })
                .ToListAsync(cancellationToken);
            var hoy = fechasYComisiones.Where(viaje =>
                viaje.FechaFinalizacion >= inicioHoyUtc && viaje.FechaFinalizacion < finHoyUtc);
            totalViajes = fechasYComisiones.Count;
            comisionesTotales = fechasYComisiones.Sum(viaje => viaje.ComisionPlataforma);
            comisionesRecibidas = fechasYComisiones
                .Where(viaje => MetodosPago.EsElectronico(viaje.MetodoPago))
                .Sum(viaje => viaje.ComisionPlataforma);
            viajesHoy = hoy.LongCount();
            recaudadoHoy = hoy.Sum(viaje => viaje.ComisionPlataforma);
        }
        else
        {
            totalViajes = await viajesFinalizados.LongCountAsync(cancellationToken);
            comisionesTotales = await viajesFinalizados.SumAsync(
                viaje => viaje.ComisionPlataforma,
                cancellationToken);
            comisionesRecibidas = await viajesFinalizados
                .Where(viaje => viaje.MetodoPago == MetodosPago.Transferencia
                    || viaje.MetodoPago == MetodosPago.Tarjeta)
                .SumAsync(viaje => (decimal?)viaje.ComisionPlataforma, cancellationToken) ?? 0m;
            var viajesFinalizadosHoy = viajesFinalizados
                .Where(viaje => viaje.FechaFinalizacion >= inicioHoyUtc
                    && viaje.FechaFinalizacion < finHoyUtc);
            viajesHoy = await viajesFinalizadosHoy.LongCountAsync(cancellationToken);
            recaudadoHoy = await viajesFinalizadosHoy.SumAsync(
                viaje => viaje.ComisionPlataforma,
                cancellationToken);
        }
        var saldosConductores = dbContext.Users.AsNoTracking()
            .Where(usuario => usuario.Rol == RolesUsuario.Conductor)
            .Select(usuario => usuario.SaldoPendiente);
        comisionesPorCobrarEfectivo = dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite"
            ? (await saldosConductores.ToListAsync(cancellationToken)).Sum()
            : await saldosConductores.SumAsync(cancellationToken);

        var estadisticas = new AdminEstadisticasResponse(
            totalViajes,
            comisionesTotales,
            comisionesRecibidas,
            comisionesPorCobrarEfectivo,
            viajesHoy,
            conductoresActivos.TotalConductoresActivos,
            recaudadoHoy);

        return Ok(estadisticas);
    }

    [HttpGet("conductores-con-deuda")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType<IReadOnlyList<ConductorConDeudaResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ConductorConDeudaResponse>>> ConductoresConDeuda(
        CancellationToken cancellationToken)
    {
        var conductoresQuery = dbContext.Users.AsNoTracking()
            .Where(usuario => usuario.Rol == RolesUsuario.Conductor);
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var conductores = await conductoresQuery
                .Select(usuario => new ConductorConDeudaResponse(
                    usuario.Id,
                    usuario.Nombre,
                    usuario.SaldoPendiente))
                .ToListAsync(cancellationToken);
            return Ok(conductores
                .Where(usuario => usuario.SaldoPendiente > 0)
                .OrderByDescending(usuario => usuario.SaldoPendiente)
                .ThenBy(usuario => usuario.Nombre)
                .ToArray());
        }

        var deudores = await conductoresQuery
            .Where(usuario => usuario.SaldoPendiente > 0)
            .OrderByDescending(usuario => usuario.SaldoPendiente)
            .ThenBy(usuario => usuario.Nombre)
            .Select(usuario => new ConductorConDeudaResponse(
                usuario.Id,
                usuario.Nombre,
                usuario.SaldoPendiente))
            .ToListAsync(cancellationToken);

        return Ok(deudores);
    }

    [HttpPost("conductores/{id}/marcar-pagado")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> MarcarSaldoPagado(string id, CancellationToken cancellationToken)
    {
        var actualizado = await dbContext.Users
            .Where(usuario => usuario.Id == id && usuario.Rol == RolesUsuario.Conductor)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(usuario => usuario.SaldoPendiente, 0m),
                cancellationToken);

        return actualizado == 0 ? NotFound() : NoContent();
    }

    [HttpGet("conductores-pendientes")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType<IReadOnlyList<ConductorPendienteResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ConductorPendienteResponse>>> ConductoresPendientes(
        CancellationToken cancellationToken)
    {
        var conductores = await dbContext.Users.AsNoTracking()
            .Where(usuario => usuario.Rol == RolesUsuario.Conductor
                && usuario.EstadoVerificacion == EstadoVerificacionConductor.Pendiente
                && usuario.UrlLicencia != null
                && usuario.UrlSOAT != null
                && usuario.UrlTarjetaPropiedad != null)
            .OrderBy(usuario => usuario.Nombre)
            .ToListAsync(cancellationToken);

        return Ok(conductores.Select(conductor => new ConductorPendienteResponse(
            conductor.Id,
            conductor.Nombre,
            conductor.Email ?? string.Empty,
            conductor.Telefono,
            CrearUrlDocumento(conductor.Id, TipoDocumentoConductor.Licencia),
            CrearUrlDocumento(conductor.Id, TipoDocumentoConductor.SOAT),
            CrearUrlDocumento(conductor.Id, TipoDocumentoConductor.TarjetaPropiedad))).ToArray());
    }

    [HttpGet("conductores-vencidos")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType<IReadOnlyList<ConductorVencidoResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ConductorVencidoResponse>>> ConductoresVencidos(
        CancellationToken cancellationToken)
    {
        var inicioHoyUtc = DateTime.UtcNow.Date;
        await dbContext.Users
            .Where(usuario => usuario.Rol == RolesUsuario.Conductor
                && usuario.EstadoVerificacion == EstadoVerificacionConductor.Aprobado
                && (usuario.FechaVencimientoDocumentos == null
                    || usuario.FechaVencimientoDocumentos < inicioHoyUtc))
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    usuario => usuario.EstadoVerificacion,
                    EstadoVerificacionConductor.Vencido),
                cancellationToken);

        var conductores = await dbContext.Users.AsNoTracking()
            .Where(usuario => usuario.Rol == RolesUsuario.Conductor
                && usuario.EstadoVerificacion == EstadoVerificacionConductor.Vencido)
            .OrderBy(usuario => usuario.FechaVencimientoDocumentos)
            .ThenBy(usuario => usuario.Nombre)
            .ToListAsync(cancellationToken);

        return Ok(conductores.Select(conductor => new ConductorVencidoResponse(
            conductor.Id,
            conductor.Nombre,
            conductor.Email ?? string.Empty,
            conductor.Telefono,
            conductor.FechaVencimientoDocumentos,
            CrearUrlDocumento(conductor.Id, TipoDocumentoConductor.Licencia),
            CrearUrlDocumento(conductor.Id, TipoDocumentoConductor.SOAT),
            CrearUrlDocumento(conductor.Id, TipoDocumentoConductor.TarjetaPropiedad))).ToArray());
    }

    [HttpPost("verificar-conductor/{id}")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType<EstadoVerificacionConductorResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<EstadoVerificacionConductorResponse>> VerificarConductor(
        string id,
        [FromBody] VerificarConductorRequest request,
        CancellationToken cancellationToken)
    {
        if (!request.Aprobado && string.IsNullOrWhiteSpace(request.MotivoRechazo))
        {
            return BadRequest(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Indica el motivo del rechazo."
            });
        }

        var conductor = await userManager.FindByIdAsync(id);
        if (conductor is null || conductor.Rol != RolesUsuario.Conductor)
        {
            return NotFound();
        }

        if (request.Aprobado)
        {
            if (!request.FechaVencimientoDocumentos.HasValue
                || request.FechaVencimientoDocumentos.Value.Date < DateTime.UtcNow.Date)
            {
                return BadRequest(new ProblemDetails
                {
                    Status = StatusCodes.Status400BadRequest,
                    Title = "Indica una fecha de vencimiento igual o posterior a hoy."
                });
            }

            var documentosCompletos =
                await documentoStorage.ExisteAsync(conductor.UrlLicencia, cancellationToken)
                && await documentoStorage.ExisteAsync(conductor.UrlSOAT, cancellationToken)
                && await documentoStorage.ExisteAsync(conductor.UrlTarjetaPropiedad, cancellationToken);
            if (!documentosCompletos)
            {
                return BadRequest(new ProblemDetails
                {
                    Status = StatusCodes.Status400BadRequest,
                    Title = "No se puede aprobar un conductor sin los tres documentos disponibles."
                });
            }
        }

        conductor.EstadoVerificacion = request.Aprobado
            ? EstadoVerificacionConductor.Aprobado
            : EstadoVerificacionConductor.Rechazado;
        conductor.MotivoRechazo = request.Aprobado ? null : request.MotivoRechazo!.Trim();
        conductor.FechaVencimientoDocumentos = request.Aprobado
            ? DateTime.SpecifyKind(request.FechaVencimientoDocumentos!.Value.Date, DateTimeKind.Utc)
            : null;
        var resultado = await userManager.UpdateAsync(conductor);
        if (!resultado.Succeeded)
        {
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "No se pudo actualizar la verificación del conductor.",
                detail: string.Join("; ", resultado.Errors.Select(error => error.Description)));
        }

        return Ok(new EstadoVerificacionConductorResponse(
            conductor.EstadoVerificacion.ToString(),
            conductor.MotivoRechazo,
            conductor.UrlLicencia is not null,
            conductor.UrlSOAT is not null,
            conductor.UrlTarjetaPropiedad is not null,
            conductor.FechaVencimientoDocumentos));
    }

    [HttpGet("conductores/{id}/documentos/{tipo}")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType(typeof(FileStreamResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DescargarDocumentoConductor(
        string id,
        string tipo,
        CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<TipoDocumentoConductor>(tipo, ignoreCase: false, out var tipoDocumento)
            || !Enum.IsDefined(tipoDocumento))
        {
            return NotFound();
        }

        var conductor = await dbContext.Users.AsNoTracking()
            .SingleOrDefaultAsync(
                usuario => usuario.Id == id && usuario.Rol == RolesUsuario.Conductor,
                cancellationToken);
        if (conductor is null)
        {
            return NotFound();
        }

        var clave = tipoDocumento switch
        {
            TipoDocumentoConductor.Licencia => conductor.UrlLicencia,
            TipoDocumentoConductor.SOAT => conductor.UrlSOAT,
            TipoDocumentoConductor.TarjetaPropiedad => conductor.UrlTarjetaPropiedad,
            _ => null
        };
        var documento = await documentoStorage.AbrirAsync(clave, cancellationToken);
        if (documento is null)
        {
            return NotFound();
        }

        return File(documento.Contenido, documento.ContentType, documento.NombreArchivo);
    }

    [HttpPost("promos")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType<PromocionResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PromocionResponse>> CrearPromocion(
        [FromBody] CrearPromocionRequest request,
        CancellationToken cancellationToken)
    {
        var promocion = await promocionService.CrearAsync(request, cancellationToken);
        return CreatedAtAction(nameof(ObtenerPromocion), new { id = promocion.Id }, promocion);
    }

    [HttpGet("promos/{id:guid}")]
    [Authorize(Roles = RolesUsuario.Admin)]
    [ProducesResponseType<PromocionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PromocionResponse>> ObtenerPromocion(
        Guid id,
        CancellationToken cancellationToken)
    {
        var promocion = await promocionService.ObtenerPorIdAsync(id, cancellationToken);
        return promocion is null ? NotFound() : Ok(promocion);
    }

    private static string CrearUrlDocumento(string conductorId, TipoDocumentoConductor tipoDocumento) =>
        $"/api/admin/conductores/{Uri.EscapeDataString(conductorId)}/documentos/{tipoDocumento}";
}
