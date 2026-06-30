use crate::{Error, Result};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConstantPoolMatch {
    pub value: String,
}

pub fn search_constant_pool(bytes: &[u8], query: &str) -> Result<Vec<ConstantPoolMatch>> {
    if bytes.len() < 10 || &bytes[..4] != b"\xCA\xFE\xBA\xBE" {
        return Err(Error::MalformedClass("missing class magic"));
    }
    let query = query.to_ascii_lowercase();
    let mut cursor = 8;
    let count = read_u16(bytes, &mut cursor)? as usize;
    let mut matches = Vec::new();
    let mut index = 1;
    while index < count {
        let tag = read_u8(bytes, &mut cursor)?;
        match tag {
            1 => {
                let length = read_u16(bytes, &mut cursor)? as usize;
                let value = read_bytes(bytes, &mut cursor, length)?;
                if let Ok(value) = std::str::from_utf8(value)
                    && value.to_ascii_lowercase().contains(&query)
                {
                    matches.push(ConstantPoolMatch {
                        value: value.to_owned(),
                    });
                }
            }
            3 | 4 => skip(bytes, &mut cursor, 4)?,
            5 | 6 => {
                skip(bytes, &mut cursor, 8)?;
                index += 1;
            }
            7 | 8 | 16 | 19 | 20 => skip(bytes, &mut cursor, 2)?,
            9 | 10 | 11 | 12 | 17 | 18 => skip(bytes, &mut cursor, 4)?,
            15 => skip(bytes, &mut cursor, 3)?,
            _ => return Err(Error::MalformedClass("unknown constant-pool tag")),
        }
        index += 1;
    }
    Ok(matches)
}

fn read_u8(bytes: &[u8], cursor: &mut usize) -> Result<u8> {
    Ok(read_bytes(bytes, cursor, 1)?[0])
}

fn read_u16(bytes: &[u8], cursor: &mut usize) -> Result<u16> {
    let bytes = read_bytes(bytes, cursor, 2)?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn skip(bytes: &[u8], cursor: &mut usize, count: usize) -> Result<()> {
    read_bytes(bytes, cursor, count).map(|_| ())
}

fn read_bytes<'a>(bytes: &'a [u8], cursor: &mut usize, count: usize) -> Result<&'a [u8]> {
    let end = cursor
        .checked_add(count)
        .ok_or(Error::MalformedClass("constant-pool length overflow"))?;
    let value = bytes
        .get(*cursor..end)
        .ok_or(Error::MalformedClass("unexpected end of class file"))?;
    *cursor = end;
    Ok(value)
}
