use std::io::{Read, Write};

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{Error, Result};

const MAX_FRAME_SIZE: usize = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DecompileEngine {
    Cfr,
    Vineflower,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SidecarAction {
    Ping,
    Decompile,
    Disassemble,
    Cancel,
}

#[derive(Clone, Debug, Default, Eq, Hash, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecompileOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decode_enums: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decompile_generics: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_classes: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub switch_expressions: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_line_numbers: Option<bool>,
}

impl DecompileOptions {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarRequest {
    pub id: String,
    pub action: SidecarAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<DecompileEngine>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub classpath: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "DecompileOptions::is_default")]
    pub options: DecompileOptions,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarResponse {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

pub fn write_frame(mut writer: impl Write, value: &impl Serialize) -> Result<()> {
    let payload = serde_json::to_vec(value)
        .map_err(|error| Error::SidecarProtocol(format!("cannot serialize frame: {error}")))?;
    let length = u32::try_from(payload.len())
        .map_err(|_| Error::SidecarProtocol("frame exceeds u32 length".to_owned()))?;
    if payload.len() > MAX_FRAME_SIZE {
        return Err(Error::SidecarProtocol(
            "frame exceeds safety limit".to_owned(),
        ));
    }
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(&payload)?;
    Ok(())
}

pub fn read_frame<T: DeserializeOwned>(mut reader: impl Read) -> Result<T> {
    let mut length = [0_u8; 4];
    reader.read_exact(&mut length)?;
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_FRAME_SIZE {
        return Err(Error::SidecarProtocol(
            "frame exceeds safety limit".to_owned(),
        ));
    }
    let mut payload = vec![0; length];
    reader.read_exact(&mut payload)?;
    serde_json::from_slice(&payload)
        .map_err(|error| Error::SidecarProtocol(format!("cannot deserialize frame: {error}")))
}
