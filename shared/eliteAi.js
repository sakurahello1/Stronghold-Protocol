// The server computes this capability from verified composed data; a plugin's display name is not authorization.
export const eliteAiAllowed = room => room?.difficulty !== 'FUNNY'
  && (room?.content?.vanilla !== false || room.content.eliteAiCompatible === true);
