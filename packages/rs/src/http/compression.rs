use napi_derive::napi;
use napi::bindgen_prelude::Buffer;
use napi::{Error, Status, Result};
use std::io::Write;
use flate2::write::{GzEncoder, DeflateEncoder};
use flate2::Compression;

#[napi]
pub fn gzip_compress(data: Buffer, level: Option<u32>) -> Result<Buffer> {
    let compression_level = match level {
        Some(l) if l <= 9 => Compression::new(l),
        _ => Compression::default(),
    };

    let mut encoder = GzEncoder::new(Vec::with_capacity(data.len()), compression_level);
    encoder.write_all(data.as_ref()).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Gzip compression error: {}", e))
    })?;

    let compressed = encoder.finish().map_err(|e| {
        Error::new(Status::GenericFailure, format!("Gzip finish error: {}", e))
    })?;

    Ok(Buffer::from(compressed))
}

#[napi]
pub fn deflate_compress(data: Buffer, level: Option<u32>) -> Result<Buffer> {
    let compression_level = match level {
        Some(l) if l <= 9 => Compression::new(l),
        _ => Compression::default(),
    };

    let mut encoder = DeflateEncoder::new(Vec::with_capacity(data.len()), compression_level);
    encoder.write_all(data.as_ref()).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Deflate compression error: {}", e))
    })?;

    let compressed = encoder.finish().map_err(|e| {
        Error::new(Status::GenericFailure, format!("Deflate finish error: {}", e))
    })?;

    Ok(Buffer::from(compressed))
}

#[napi]
pub fn brotli_compress(data: Buffer, quality: Option<u32>, lgwin: Option<u32>) -> Result<Buffer> {
    let q = quality.unwrap_or(6);
    let lg = lgwin.unwrap_or(22);

    let mut output = Vec::with_capacity(data.len());
    let mut writer = brotli::CompressorWriter::new(&mut output, 4096, q, lg);

    writer.write_all(data.as_ref()).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Brotli compression error: {}", e))
    })?;

    writer.flush().map_err(|e| {
        Error::new(Status::GenericFailure, format!("Brotli flush error: {}", e))
    })?;
    drop(writer);

    Ok(Buffer::from(output))
}

#[napi]
pub fn compress_best(data: Buffer, accept_encoding: String) -> Result<Option<Buffer>> {
    let ae = accept_encoding.to_ascii_lowercase();

    // Prioritize Brotli, then Gzip, then Deflate
    if ae.contains("br") {
        let compressed = brotli_compress(data, Some(5), Some(20))?;
        return Ok(Some(compressed));
    }

    if ae.contains("gzip") {
        let compressed = gzip_compress(data, Some(6))?;
        return Ok(Some(compressed));
    }

    if ae.contains("deflate") {
        let compressed = deflate_compress(data, Some(6))?;
        return Ok(Some(compressed));
    }

    Ok(None)
}
