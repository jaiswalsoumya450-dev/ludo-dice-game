"use strict";

$(document).ready(function () {
  //get token and _id from localStorage, if not found, redirect to login page
  const token = localStorage.getItem("token");
  const _id = localStorage.getItem("_id");

  if (!token || !_id) {
    window.location.href = "/web/login";
    return;
  }

  // Populate from localStorage immediately to avoid flash
  //aka set the name and chips from localStorage to the display from before
  //then quickly check after to see if the data is still valid, if not, update it from the API
  setName(localStorage.getItem("sName"));
  const cachedChips = localStorage.getItem("chips");
  //Number() converts the string to a number
  //because localStorage stores everything as strings, so we need to convert it back to a number for display
  if (cachedChips !== null) setChips(Number(cachedChips));

  // Refresh from API
  fetchUser(function (user) {
    setName(user.sName);
    localStorage.setItem("sName", user.sName);
  });

  // Name button -> open popup with fresh user data
  $("#name-btn").on("click", function () {
    fetchUser(function (user) {
      $("#popup-avatar").text(
        user.sName ? user.sName.charAt(0).toUpperCase() : "?",
      );
      $("#popup-name").val(user.sName);
      showPopup();
    });
  });

  // Close popup on X or overlay click
  $("#close-popup").on("click", hidePopup);
  $("#popup-overlay").on("click", function (e) {
    if (e.target === this) hidePopup();
  });

  // Save name
  $("#save-btn").on("click", function () {
    const newName = $("#popup-name").val().trim();
    if (!newName) {
      showPopupMsg("Name cannot be empty.");
      return;
    }

    $.ajax({
      url: `${API_BASE_URL}/api/v1/user`,
      type: "PUT",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      data: JSON.stringify({ _id, sName: newName }),
      success: function (result) {
        const updated = result.data;
        localStorage.setItem("sName", updated.sName);
        setName(updated.sName);
        hidePopup();
      },
      error: function () {
        showPopupMsg("Failed to save. Try again.");
      },
    });
  });

  // Delete account
  $("#delete-account-btn").on("click", function () {
    $.ajax({
      url: `${API_BASE_URL}/api/v1/user/${_id}`,
      type: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      success: function () {
        localStorage.clear();
        window.location.href = "/web/login";
      },
      error: function () {
        showPopupMsg("Failed to delete. Try again.");
      },
    });
  });

  // Public mode popup
  $("#public-mode").on("click", function () {
    showPublicPopup();
  });

  $("#pub-close-popup").on("click", hidePubPopup);
  $("#pub-popup-overlay").on("click", function (e) {
    if (e.target === this) hidePubPopup();
  });

  $("#play-pub-btn").on("click", function () {
    const maxPlayers = parseInt($("#pub-max-players").val(), 4);
    const lobbyAmt = parseInt($("#pub-lobby-amt").val(), 1000);

    if (!maxPlayers || maxPlayers < 2 || maxPlayers > 4) {
      showPubPopupMsg("Max players must be between 2 and 4!");
      return;
    }
    if (!lobbyAmt || lobbyAmt < 1) {
      showPubPopupMsg("Lobby amount must be between 0 and 1000!");
      return;
    }

    //pass maxPlayers and lobbyAmt to the matchmaking call
    hidePubPopup();
  });

  // Private mode popup
  $("#private-mode").on("click", function () {
    showPrivatePopup();
  });

  $("#pri-close-popup").on("click", hidePriPopup);
  $("#pri-popup-overlay").on("click", function (e) {
    if (e.target === this) hidePriPopup();
  });

  $("#play-pri-btn").on("click", function () {
    const maxPlayers = parseInt($("#pri-max-players").val(), 4);
    const lobbyAmt = parseInt($("#pri-lobby-amt").val(), 1000);

    if (!maxPlayers || maxPlayers < 2 || maxPlayers > 4) {
      showPriPopupMsg("Max players must be between 2 and 4!");
      return;
    }
    if (!lobbyAmt || lobbyAmt < 0 || lobbyAmt > 1000) {
      showPriPopupMsg("Lobby amount must be between 0 and 1000!");
      return;
    }

    //pass maxPlayers and lobbyAmt to the matchmaking call
    hidePriPopup();
  });

  function fetchUser(callback) {
    $.ajax({
      url: `${API_BASE_URL}/api/v1/user/${_id}`,
      type: "GET",
      headers: { Authorization: `Bearer ${token}` },
      success: function (result) {
        callback(result.data);
      },
      error: function () {
        console.error("Failed to fetch user.");
      },
    });
  }

  function setName(name) {
    $("#display-name").text(name || "");
    $("#avatar-initial").text(name ? name.charAt(0).toUpperCase() : "?");
  }

  function setChips(amount) {
    $("#chips-display").text(Number(amount).toLocaleString());
  }

  function showPopup() {
    $("#popup-msg").addClass("hidden").text("");
    $("#popup-overlay").addClass("open");
  }

  function hidePopup() {
    $("#popup-overlay").removeClass("open");
  }

  function showPopupMsg(msg) {
    $("#popup-msg").text(msg).removeClass("hidden");
  }

  function showPublicPopup() {
    $("#pub-popup-msg").addClass("hidden").text("");
    $("#pub-max-players").val("");
    $("#pub-lobby-amt").val("");
    $("#pub-popup-overlay").addClass("open");
  }

  function hidePubPopup() {
    $("#pub-popup-overlay").removeClass("open");
  }

  function showPubPopupMsg(msg) {
    $("#pub-popup-msg").text(msg).removeClass("hidden");
  }

  function showPrivatePopup() {
    $("#pri-popup-msg").addClass("hidden").text("");
    $("#pri-max-players").val("");
    $("#pri-lobby-amt").val("");
    $("#pri-popup-overlay").addClass("open");
  }

  function hidePriPopup() {
    $("#pri-popup-overlay").removeClass("open");
  }

  function showPriPopupMsg(msg) {
    $("#pri-popup-msg").text(msg).removeClass("hidden");
  }
  

function logout() {
  localStorage.clear();
  window.location.href = "/web/login";
}
});